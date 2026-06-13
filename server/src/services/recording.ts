import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { Queue, Worker } from 'bullmq';
import type { Consumer, PlainTransport, Producer, Router } from 'mediasoup/node/lib/types';
import { query } from '../config/db';
import { storageClient, fileBucket, getObjectUrl, ensureFileBucket } from '../config/storage';

interface RecordingTrack {
  producerId: string;
  kind: 'audio' | 'video';
  filePath: string;
  sdpPath: string;
  transport: PlainTransport;
  consumer: Consumer;
  ffmpeg: ChildProcessWithoutNullStreams;
}

interface RecordingState {
  sessionId: string;
  dir: string;
  tracks: Map<string, RecordingTrack>;
  startedAt: number;
}

interface MuxJob {
  sessionId: string;
  dir: string;
  trackFiles: string[];
}

const recordings = new Map<string, RecordingState>();
const recordingRoot = process.env.RECORDING_DIR ?? path.join(process.cwd(), 'recordings');
const redisConnection = {
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

const RECORDING_QUEUE_NAME = 'recording-mux';

export const recordingQueue = new Queue<MuxJob>(RECORDING_QUEUE_NAME, { connection: redisConnection });

function waitForExit(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('exit', done);
    child.kill(signal);
    setTimeout(() => {
      if (!settled) child.kill('SIGKILL');
      done();
    }, 2500).unref();
  });
}

function codecForConsumer(consumer: Consumer): { payloadType: number; codecName: string; clockRate: number; channels?: number } {
  const codec = consumer.rtpParameters.codecs[0];
  const mimeSubtype = codec.mimeType.split('/')[1] ?? (consumer.kind === 'audio' ? 'opus' : 'VP8');

  return {
    payloadType: codec.payloadType,
    codecName: mimeSubtype.toUpperCase(),
    clockRate: codec.clockRate,
    channels: codec.channels,
  };
}

function buildSdp(consumer: Consumer, port: number): string {
  const codec = codecForConsumer(consumer);
  const media = consumer.kind === 'audio' ? 'audio' : 'video';
  const rtpmap = codec.channels
    ? `${codec.payloadType} ${codec.codecName}/${codec.clockRate}/${codec.channels}`
    : `${codec.payloadType} ${codec.codecName}/${codec.clockRate}`;
  const ssrc = consumer.rtpParameters.encodings?.[0]?.ssrc;

  return [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=AtomQuest Recording',
    'c=IN IP4 127.0.0.1',
    't=0 0',
    `m=${media} ${port} RTP/AVP ${codec.payloadType}`,
    `a=rtpmap:${rtpmap}`,
    // rtcpMux=true means RTCP is multiplexed on the same port as RTP
    // Without this line FFmpeg would try to open a separate RTCP port, causing packet drops
    'a=rtcp-mux',
    ssrc ? `a=ssrc:${ssrc} cname:atomquest` : '',
    '',
  ].filter(Boolean).join('\r\n');
}

async function attachProducer(state: RecordingState, router: Router, producer: Producer): Promise<void> {
  if (state.tracks.has(producer.id)) return;
  if (producer.kind !== 'audio' && producer.kind !== 'video') return;

  const rtpPort = parseInt(process.env.RECORDING_RTP_PORT ?? '5004', 10) + state.tracks.size * 2;
  const transport = await router.createPlainTransport({
    listenInfo: {
      protocol: 'udp',
      ip: process.env.RECORDING_LISTEN_IP ?? '127.0.0.1',
    },
    rtcpMux: true,
    comedia: false,
  });
  await transport.connect({ ip: '127.0.0.1', port: rtpPort });

  const consumer = await transport.consume({
    producerId: producer.id,
    rtpCapabilities: router.rtpCapabilities,
    paused: true,
  });

  const filePath = path.join(state.dir, `${producer.id}-${producer.kind}.webm`);
  const sdpPath = path.join(state.dir, `${producer.id}.sdp`);
  await fs.promises.writeFile(sdpPath, buildSdp(consumer, rtpPort));

  const ffmpeg = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', [
    '-hide_banner',
    '-loglevel', 'warning',
    '-protocol_whitelist', 'file,udp,rtp',
    '-fflags', '+genpts+discardcorrupt',
    // Increase jitter buffer: prevents "max delay reached" / "missed N packets" warnings
    '-max_delay', '5000000',        // 5 seconds in microseconds
    '-reorder_queue_size', '65535', // large reorder queue for out-of-order RTP packets
    '-i', sdpPath,
    '-c', 'copy',
    '-y',
    filePath,
  ]);

  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    console.warn(`[Recording] ffmpeg ${producer.id}: ${chunk.toString().trim()}`);
  });
  ffmpeg.on('error', (err) => {
    console.error(`[Recording] ffmpeg spawn error for ${producer.id}: ${err.message}`);
  });

  await consumer.resume();
  state.tracks.set(producer.id, {
    producerId: producer.id,
    kind: producer.kind,
    filePath,
    sdpPath,
    transport,
    consumer,
    ffmpeg,
  });

  producer.on('transportclose', () => {
    void detachTrack(state.sessionId, producer.id, false);
  });
}

async function detachTrack(sessionId: string, producerId: string, kill = true): Promise<void> {
  const state = recordings.get(sessionId);
  const track = state?.tracks.get(producerId);
  if (!state || !track) return;

  state.tracks.delete(producerId);
  track.consumer.close();
  track.transport.close();
  await waitForExit(track.ffmpeg, kill ? 'SIGKILL' : 'SIGTERM');
}

export async function startRecording(sessionId: string, router: Router, producers: Iterable<Producer>): Promise<void> {
  if (recordings.has(sessionId)) return;

  const dir = path.join(recordingRoot, sessionId, String(Date.now()));
  await fs.promises.mkdir(dir, { recursive: true });
  const state: RecordingState = { sessionId, dir, tracks: new Map(), startedAt: Date.now() };
  recordings.set(sessionId, state);

  for (const producer of producers) {
    await attachProducer(state, router, producer);
  }
}

export async function recordProducer(sessionId: string, router: Router, producer: Producer): Promise<void> {
  const state = recordings.get(sessionId);
  if (!state) return;
  await attachProducer(state, router, producer);
}

export async function stopRecording(sessionId: string, enqueueMux = true): Promise<void> {
  const state = recordings.get(sessionId);
  if (!state) return;

  const tracks = Array.from(state.tracks.values());
  await Promise.all(tracks.map(async (track) => {
    state.tracks.delete(track.producerId);
    track.consumer.close();
    track.transport.close();
    await waitForExit(track.ffmpeg, 'SIGTERM');
  }));
  recordings.delete(sessionId);

  if (enqueueMux) {
    const trackFiles = tracks.map((track) => track.filePath);
    await recordingQueue.add('mux-upload', { sessionId, dir: state.dir, trackFiles });
  }
}

export async function killRecording(sessionId: string): Promise<void> {
  const state = recordings.get(sessionId);
  if (!state) return;

  recordings.delete(sessionId);
  await Promise.all(Array.from(state.tracks.values()).map(async (track) => {
    track.consumer.close();
    track.transport.close();
    await waitForExit(track.ffmpeg, 'SIGKILL');
  }));
}

function spawnMux(job: MuxJob, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existingFiles = job.trackFiles.filter((file) => fs.existsSync(file) && fs.statSync(file).size > 0);
    if (existingFiles.length === 0) {
      reject(new Error('No recording tracks were captured'));
      return;
    }

    const videoFiles = existingFiles.filter((f) => f.includes('-video.webm'));
    const audioFiles = existingFiles.filter((f) => f.includes('-audio.webm'));
    
    // Pass ALL files as inputs
    const allFiles = [...videoFiles, ...audioFiles];
    const args = allFiles.flatMap((file) => ['-i', file]);
    
    const filterParts: string[] = [];
    const mapArgs: string[] = [];

    // --- VIDEO COMPOSITION ---
    if (videoFiles.length === 1) {
      // 1 video: scale it (force even width to avoid vp9 codec errors)
      filterParts.push(`[0:v]scale=trunc(oh*a/2)*2:480[vout]`);
      mapArgs.push('-map', '[vout]');
    } else if (videoFiles.length > 1) {
      // Multiple videos: scale all to height 480 (even width), then stack horizontally
      const scaledVideoLabels = videoFiles.map((_, i) => {
        filterParts.push(`[${i}:v]scale=trunc(oh*a/2)*2:480[v${i}]`);
        return `[v${i}]`;
      });
      filterParts.push(`${scaledVideoLabels.join('')}hstack=inputs=${videoFiles.length}[vout]`);
      mapArgs.push('-map', '[vout]');
    }

    // --- AUDIO MIXING ---
    if (audioFiles.length === 1) {
      // 1 audio file: pass it through directly
      const audioIdx = videoFiles.length;
      mapArgs.push('-map', `${audioIdx}:a`);
    } else if (audioFiles.length > 1) {
      // Mix multiple audio files into one
      const audioLabels = audioFiles.map((_, i) => `[${videoFiles.length + i}:a]`);
      filterParts.push(`${audioLabels.join('')}amix=inputs=${audioFiles.length}:duration=longest[aout]`);
      mapArgs.push('-map', '[aout]');
    }

    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', 'warning',
      ...args,
    ];

    if (filterParts.length > 0) {
      ffmpegArgs.push('-filter_complex', filterParts.join(';'));
    }

    if (mapArgs.length > 0) {
      ffmpegArgs.push(...mapArgs);
    } else {
      // Fallback if no filters were added (shouldn't happen, but just in case)
      ffmpegArgs.push('-c', 'copy');
    }

    if (filterParts.length > 0) {
      // Re-encode composited streams
      ffmpegArgs.push(
        '-c:v', 'libvpx-vp9',
        '-crf', '30',
        '-b:v', '0',
        '-c:a', 'libopus'
      );
    }

    ffmpegArgs.push('-y', outputPath);

    console.log('[Recording] FFMPEG CMD:', ffmpegArgs.join(' '));

    const child = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', ffmpegArgs);

    child.stderr.on('data', (d) => console.log(`[FFmpeg Muxer] ${d.toString().trim()}`));

    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg mux failed with exit code ${code ?? 'unknown'}`));
    });
    child.once('error', reject);
  });
}

new Worker<MuxJob>(RECORDING_QUEUE_NAME, async (job) => {
  const outputPath = path.join(job.data.dir, 'final.webm');

  console.log(`[Recording] Muxing session ${job.data.sessionId} from ${job.data.trackFiles.length} tracks`);
  await spawnMux(job.data, outputPath);
  console.log(`[Recording] Mux complete: ${outputPath}`);

  let recordingUrl: string;
  try {
    await ensureFileBucket();
    const objectKey = `recordings/${job.data.sessionId}/${path.basename(job.data.dir)}.webm`;
    await storageClient.putObject(fileBucket, objectKey, fs.createReadStream(outputPath), undefined, {
      'Content-Type': 'video/webm',
    });
    recordingUrl = await getObjectUrl(objectKey);
    console.log(`[Recording] Uploaded to S3: ${recordingUrl}`);
  } catch (uploadErr) {
    // S3 unavailable — serve the local file directly via the API
    console.warn(`[Recording] S3 upload failed, using local path fallback: ${(uploadErr as Error).message}`);
    recordingUrl = `/api/recordings/${job.data.sessionId}/${path.basename(job.data.dir)}/final.webm`;
  }

  await query(
    `UPDATE sessions SET recording_url = $2 WHERE id = $1`,
    [job.data.sessionId, recordingUrl],
  );
  console.log(`[Recording] DB updated for session ${job.data.sessionId}: ${recordingUrl}`);
}, { connection: redisConnection });

export function isRecording(sessionId: string): boolean {
  return recordings.has(sessionId);
}
