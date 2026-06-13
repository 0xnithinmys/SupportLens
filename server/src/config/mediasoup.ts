import os from 'os';
import * as mediasoup from 'mediasoup';
import type { Worker, Router } from 'mediasoup/node/lib/types';
import type { RouterRtpCodecCapability } from 'mediasoup/node/lib/rtpParametersTypes';

// ── Codec configuration ────────────────────────────────────────────────────
export const mediaCodecs: RouterRtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
    parameters: { minptime: 10, useinbandfec: 1 },
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {},
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
    },
  },
];

// ── Worker pool ────────────────────────────────────────────────────────────
const workers: Worker[] = [];
let workerIndex = 0;

export async function createWorkers(): Promise<void> {
  const numWorkers = Math.min(
    os.cpus().length,
    parseInt(process.env.MEDIASOUP_WORKERS ?? '2', 10),
  );

  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: 'warn',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
      rtcMinPort: parseInt(process.env.MEDIASOUP_MIN_PORT ?? '10000', 10),
      rtcMaxPort: parseInt(process.env.MEDIASOUP_MAX_PORT ?? '10100', 10),
    });

    worker.on('died', (error: Error) => {
      console.error(`[Mediasoup] Worker died (pid:${worker.pid}):`, error.message);
    });

    workers.push(worker);
    console.log(`[Mediasoup] Worker created (pid:${worker.pid})`);
  }
}

/** Round-robin worker selection */
function getNextWorker(): Worker {
  const worker = workers[workerIndex];
  workerIndex = (workerIndex + 1) % workers.length;
  return worker;
}

/** Create a Mediasoup Router — one per call room */
export async function createRouter(): Promise<Router> {
  const worker = getNextWorker();
  return worker.createRouter({ mediaCodecs });
}
