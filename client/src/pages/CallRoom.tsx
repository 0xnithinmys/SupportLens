import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Device } from 'mediasoup-client';
import type {
  Consumer,
  DtlsParameters,
  IceCandidate,
  IceParameters,
  MediaKind,
  Producer,
  RtpCapabilities,
  RtpParameters,
  Transport,
} from 'mediasoup-client/types';
import {
  Camera,
  CameraOff,
  Download,
  FileText,
  FileUp,
  Image,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Radio,
  Send,
  Users,
  Video,
  X,
} from 'lucide-react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { api } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import type { ParticipantRole } from '@/types';

interface ServerToClientEvents {
  'room:closed': () => void;
  'participant:joined': (data: { displayName: string; role: ParticipantRole | 'ADMIN'; socketId: string }) => void;
  'participant:left': (data: { displayName: string; role: ParticipantRole | 'ADMIN'; socketId: string }) => void;
  'router:capabilities': (data: { rtpCapabilities: RtpCapabilities }) => void;
  'newProducer': (data: { producerId: string; socketId: string; kind: string }) => void;
  'chat:receive': (msg: { id: string; senderName: string; payload: string; isFile: boolean; timestamp: string }) => void;
  'heartbeat:ping': () => void;
  'recording:status': (data: { active: boolean; message: string }) => void;
  'room:force_mute': () => void;
  'room:kicked': () => void;
  error: (data: { message: string }) => void;
}

interface CallMessage {
  id: string;
  senderName: string;
  payload: string;
  isFile: boolean;
  timestamp: string;
}

interface FileUploadResponse {
  url: string;
  objectKey: string;
  filename: string;
  mimeType: string;
  sizeLimit: number;
}

interface ClientToServerEvents {
  'room:join': (data: { sessionId: string; displayName?: string }) => void;
  'transport:create': (data: { direction: 'send' | 'recv' }, cb: (params: TransportOptions | ErrorResponse) => void) => void;
  'transport:connect': (data: { transportId: string; dtlsParameters: DtlsParameters }, cb: () => void) => void;
  'transport:restartIce': (data: { transportId: string }, cb: (params: IceRestartResponse | ErrorResponse) => void) => void;
  produce: (
    data: { transportId: string; kind: MediaKind; rtpParameters: RtpParameters; appData?: Record<string, unknown> },
    cb: (producerId: string) => void,
  ) => void;
  consume: (
    data: { transportId: string; producerId: string; rtpCapabilities: RtpCapabilities },
    cb: (params: ConsumerOptions | ErrorResponse) => void,
  ) => void;
  'consumer:resume': (data: { consumerId: string }, cb?: () => void) => void;
  'heartbeat:pong': () => void;
  'agent:start_recording': (cb?: (data: { ok: boolean; error?: string }) => void) => void;
  'agent:stop_recording': (cb?: (data: { ok: boolean; error?: string }) => void) => void;
  'telemetry:media': (data: { rtt: number; jitter: number; packetLossFraction: number; timestamp: number }) => void;
  'chat:send': (data: { payload: string; isFile?: boolean }) => void;
  'agent:end_session': (cb?: (data: { ok: boolean; error?: string }) => void) => void;
  'agent:mute_all': (cb?: (data: { ok: boolean; error?: string }) => void) => void;
  'agent:remove_participant': (data: { socketId: string }, cb?: (data: { ok: boolean; error?: string }) => void) => void;
}

interface TransportOptions {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
}

interface ConsumerOptions {
  id: string;
  producerId: string;
  kind: MediaKind;
  rtpParameters: RtpParameters;
}

interface IceRestartResponse {
  iceParameters: IceParameters;
}

interface ErrorResponse {
  error: string;
}

interface MediaTile {
  id: string;
  label: string;
  role: 'local' | 'remote' | 'screen';
  stream: MediaStream;
  kind: MediaKind | 'screen';
  muted?: boolean;
}

interface ParticipantItem {
  id: string;
  displayName: string;
  role: ParticipantRole | 'ADMIN';
}

type CallSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type CallState = 'connecting' | 'live' | 'closed' | 'failed';

function isSessionId(value: string | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasError(value: TransportOptions | ConsumerOptions | IceRestartResponse | ErrorResponse): value is ErrorResponse {
  return 'error' in value;
}

function toFileUrl(payload: string): URL | null {
  try {
    return new URL(payload);
  } catch {
    return null;
  }
}

function isPreviewImage(url: URL): boolean {
  return /\.(apng|avif|gif|jpe?g|png|webp)$/i.test(url.pathname);
}

function ChatMessageBubble({ message }: { message: CallMessage }): React.ReactElement {
  const fileUrl = message.isFile ? toFileUrl(message.payload) : null;

  return (
    <div className="rounded-md bg-muted p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold text-primary">{message.senderName}</p>
        <time className="text-[0.68rem] text-muted-foreground">
          {new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(message.timestamp))}
        </time>
      </div>

      {message.isFile ? (
        <div className="grid gap-2">
          {fileUrl && isPreviewImage(fileUrl) ? (
            <a href={fileUrl.href} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border bg-background">
              <img src={fileUrl.href} alt="Shared file preview" className="max-h-44 w-full object-cover" loading="lazy" />
            </a>
          ) : null}
          <a
            href={fileUrl?.href ?? message.payload}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-md border bg-background/70 p-2 text-sm text-foreground transition-colors hover:bg-accent"
          >
            {fileUrl && isPreviewImage(fileUrl) ? <Image className="size-4 text-primary" /> : <FileText className="size-4 text-primary" />}
            <span className="min-w-0 flex-1 truncate">{fileUrl?.pathname.split('/').pop() || message.payload}</span>
            <Download className="size-4 text-muted-foreground" />
          </a>
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm">{message.payload}</p>
      )}
    </div>
  );
}

function VideoTile({ tile }: { tile: MediaTile }): React.ReactElement {
  const ref = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = tile.stream;
      // Changing srcObject can pause the element in some browsers, always ensure it's playing
      ref.current.play().catch((err) => {
        console.warn(`[VideoTile] Auto-play prevented for ${tile.id}:`, err);
      });
    }
  }, [tile.id, tile.stream, tile.kind]);

  return (
    <div className="group relative overflow-hidden rounded-lg border bg-muted shadow-lg">
      <video
        ref={ref as React.RefObject<HTMLVideoElement>}
        autoPlay
        muted={tile.muted}
        playsInline
        className={cn(
          'aspect-video h-full w-full object-cover',
          tile.role === 'local' && 'scale-x-[-1]',
          tile.kind === 'audio' && 'hidden'
        )}
        style={{ minHeight: '12rem' }} // min-h-48 equivalent
      />
      
      {tile.kind === 'audio' && (
        <div className="absolute inset-0 grid place-items-center bg-card/90 p-5">
          <div className="text-center">
            <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-primary/10 text-primary">
              <Mic className="size-7" />
            </div>
            <p className="font-medium">{tile.label}</p>
            <p className="text-sm text-muted-foreground">Audio only</p>
          </div>
        </div>
      )}

      {/* Name Overlay */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-md bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
        {tile.role === 'local' ? 'You' : tile.label}
        {tile.muted && <MicOff className="size-3 text-red-400" />}
      </div>
    </div>
  );
}

function CallRoom(): React.ReactElement {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const displayName = user?.email ?? searchParams.get('name') ?? 'Customer';
  const [callState, setCallState] = useState<CallState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteTiles, setRemoteTiles] = useState<MediaTile[]>([]);
  const [participants, setParticipants] = useState<ParticipantItem[]>([]);
  const [messages, setMessages] = useState<CallMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [messageIsFile, setMessageIsFile] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const socketRef = useRef<CallSocket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const recvTransportRef = useRef<Transport | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const producersRef = useRef<Producer[]>([]);
  const consumersRef = useRef<Consumer[]>([]);
  const consumedProducersRef = useRef<Set<string>>(new Set());
  const screenProducerRef = useRef<Producer | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const telemetryIntervalRef = useRef<number | null>(null);
  const pendingProducersRef = useRef<Array<{ producerId: string; socketId: string; kind: string }>>([]);
  const recvTransportPromiseRef = useRef<Promise<Transport> | null>(null);

  const localTiles = useMemo<MediaTile[]>(() => {
    const tiles: MediaTile[] = [];
    if (localStream) {
      tiles.push({ id: 'local-camera', label: 'You', role: 'local', stream: localStream, kind: 'video', muted: true });
    }
    if (screenStream) {
      tiles.push({ id: 'local-screen', label: 'Your screen', role: 'screen', stream: screenStream, kind: 'screen', muted: true });
    }
    return tiles;
  }, [localStream, screenStream]);
  const allTiles = [...localTiles, ...remoteTiles];

  useEffect(() => {
    document.title = 'Active Call - AtomQuest';
    if (!isSessionId(sessionId)) return;

    let aborted = false;
    void startCall(() => aborted);

    const handleUnload = (): void => {
      socketRef.current?.disconnect();
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      aborted = true;
      window.removeEventListener('beforeunload', handleUnload);
      cleanupCall();
    };
  }, [sessionId]);

  if (!isSessionId(sessionId)) {
    return <Navigate to="/login" replace />;
  }

  function requestTransport(socket: CallSocket, direction: 'send' | 'recv'): Promise<TransportOptions> {
    return new Promise((resolve, reject) => {
      socket.emit('transport:create', { direction }, (params) => {
        if (hasError(params)) reject(new Error(params.error));
        else resolve(params);
      });
    });
  }

  function monitorTransportIce(socket: CallSocket, transport: Transport): void {
    transport.on('connectionstatechange', (state) => {
      if (state !== 'failed' && state !== 'disconnected') return;

      socket.emit('transport:restartIce', { transportId: transport.id }, (response) => {
        if (hasError(response)) {
          setError(response.error);
          return;
        }
        void transport.restartIce({ iceParameters: response.iceParameters });
      });
    });
  }

  function startTelemetry(socket: CallSocket): void {
    if (telemetryIntervalRef.current) window.clearInterval(telemetryIntervalRef.current);

    telemetryIntervalRef.current = window.setInterval(async () => {
      const transports = [sendTransportRef.current, recvTransportRef.current].filter(Boolean) as Transport[];
      const reports = await Promise.allSettled(transports.map((transport) => transport.getStats()));
      let rtt = 0;
      let jitter = 0;
      let packetLossFraction = 0;
      let count = 0;

      for (const report of reports) {
        if (report.status !== 'fulfilled') continue;
        report.value.forEach((stat) => {
          const data = stat as RTCStats & {
            currentRoundTripTime?: number;
            roundTripTime?: number;
            jitter?: number;
            packetsLost?: number;
            packetsReceived?: number;
          };
          const nextRtt = data.currentRoundTripTime ?? data.roundTripTime;
          if (typeof nextRtt === 'number') rtt += nextRtt;
          if (typeof data.jitter === 'number') jitter += data.jitter;
          if (typeof data.packetsLost === 'number' && typeof data.packetsReceived === 'number') {
            const total = data.packetsLost + data.packetsReceived;
            if (total > 0) packetLossFraction += data.packetsLost / total;
          }
          count += 1;
        });
      }

      socket.emit('telemetry:media', {
        rtt: count > 0 ? rtt / count : 0,
        jitter: count > 0 ? jitter / count : 0,
        packetLossFraction: count > 0 ? packetLossFraction / count : 0,
        timestamp: Date.now(),
      });
    }, 3000);
  }

  async function setupSendTransport(socket: CallSocket, device: Device, media: MediaStream): Promise<void> {
    const params = await requestTransport(socket, 'send');
    const transport = device.createSendTransport(params);
    sendTransportRef.current = transport;
    monitorTransportIce(socket, transport);

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      socket.emit('transport:connect', { transportId: transport.id, dtlsParameters }, callback);
      transport.once('connectionstatechange', (state) => {
        if (state === 'failed') errback(new Error('Send transport failed'));
      });
    });

    transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      socket.emit('produce', { transportId: transport.id, kind, rtpParameters, appData }, (producerId) => {
        if (!producerId) errback(new Error('Unable to produce media'));
        else callback({ id: producerId });
      });
    });

    for (const track of media.getTracks()) {
      const producer = await transport.produce({ track, appData: { source: track.kind } });
      producersRef.current.push(producer);
    }
  }

  async function getRecvTransport(socket: CallSocket, device: Device): Promise<Transport> {
    if (recvTransportRef.current) return recvTransportRef.current;

    // Use a promise ref to prevent concurrent consume calls from creating multiple transports
    if (!recvTransportPromiseRef.current) {
      recvTransportPromiseRef.current = (async () => {
        const params = await requestTransport(socket, 'recv');
        const transport = device.createRecvTransport(params);
        recvTransportRef.current = transport;
        monitorTransportIce(socket, transport);

        transport.on('connect', ({ dtlsParameters }, callback) => {
          socket.emit('transport:connect', { transportId: transport.id, dtlsParameters }, callback);
        });

        return transport;
      })();
    }
    return recvTransportPromiseRef.current;
  }

  async function consumeProducer(producerId: string, socketId: string, kindHint: string): Promise<void> {
    console.log(`[Mediasoup] consumeProducer called for ${producerId} (socket: ${socketId}, kind: ${kindHint})`);
    const socket = socketRef.current;
    const device = deviceRef.current;
    if (!socket || !device) {
      console.warn(`[Mediasoup] Cannot consume ${producerId} - socket or device missing`);
      return;
    }
    if (consumedProducersRef.current.has(producerId)) {
      console.warn(`[Mediasoup] Already consumed ${producerId}`);
      return;
    }

    consumedProducersRef.current.add(producerId);
    try {
      console.log(`[Mediasoup] Getting recv transport for ${producerId}`);
      const transport = await getRecvTransport(socket, device);

      console.log(`[Mediasoup] Requesting consume from server for ${producerId}`);
      const params = await new Promise<ConsumerOptions>((resolve, reject) => {
        socket.emit(
          'consume',
          { transportId: transport.id, producerId, rtpCapabilities: device.rtpCapabilities },
          (response) => {
            if (hasError(response)) reject(new Error(response.error));
            else resolve(response);
          },
        );
      });

      const consumer = await transport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });
      consumersRef.current.push(consumer);

      setRemoteTiles((current) => {
        const isScreen = kindHint === 'screen';
        // Screen tiles get a distinct id so they never collide with the camera tile from same socket
        const tileId = isScreen ? `${socketId}:screen` : socketId;
        const existingIdx = current.findIndex((t) => t.id === tileId);

        if (existingIdx >= 0) {
          // Create a new MediaStream combining existing tracks + new track
          // (new reference so VideoTile's useEffect fires and updates srcObject)
          const existing = current[existingIdx];
          const newStream = new MediaStream([...existing.stream.getTracks(), consumer.track]);

          const updated = [...current];
          updated[existingIdx] = {
            ...existing,
            stream: newStream,
            kind: newStream.getVideoTracks().length > 0 ? 'video' : 'audio',
          };
          return updated;
        }

        // Create new tile for this participant
        const stream = new MediaStream([consumer.track]);
        return [
          ...current,
          {
            id: tileId,
            label: isScreen ? 'Remote screen' : 'Remote participant',
            role: (isScreen ? 'screen' : 'remote') as 'remote' | 'screen',
            stream,
            kind: consumer.kind,
          },
        ];
      });



      socket.emit('consumer:resume', { consumerId: consumer.id });
      console.log(`[Mediasoup] Successfully consumed ${producerId} (${consumer.kind})`);
    } catch (err) {
      console.error(`[Mediasoup] Failed to consume ${producerId}:`, err);
      consumedProducersRef.current.delete(producerId);
    }
  }


  async function startCall(isAborted: () => boolean): Promise<void> {
    if (!sessionId) return;
    const roomId = sessionId;
    setCallState('connecting');
    setError(null);

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      });
      if (isAborted()) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      localStreamRef.current = media;
      setLocalStream(media);

      const socket: CallSocket = io('/', {
        auth: token ? { token, sessionId: roomId } : { sessionId: roomId, displayName },
        transports: ['websocket', 'polling'],
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('room:join', { sessionId: roomId, displayName });
      });

      socket.on('router:capabilities', async ({ rtpCapabilities }) => {
        try {
          const device = new Device();
          await device.load({ routerRtpCapabilities: rtpCapabilities });
          if (isAborted()) return;

          deviceRef.current = device;
          await setupSendTransport(socket, device, media);
          if (isAborted()) return;

          startTelemetry(socket);
          setCallState('live');

          // Process any producers that arrived while we were loading
          const pending = [...pendingProducersRef.current];
          pendingProducersRef.current = [];
          for (const p of pending) {
            void consumeProducer(p.producerId, p.socketId, p.kind);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Unable to start media transports');
          setCallState('failed');
        }
      });

      socket.on('newProducer', ({ producerId, socketId, kind }) => {
        console.log(`[Mediasoup] Received newProducer event: ${producerId} (socket: ${socketId}, kind: ${kind})`);

        if (kind === 'screen-closed') {
          // Remove the remote screen tile for this participant
          setRemoteTiles((current) => current.filter((t) => t.id !== `${socketId}:screen`));
          return;
        }

        if (kind === 'closed') {
          // Remove the remote camera/audio tile for this participant
          setRemoteTiles((current) => current.filter((t) => t.id !== socketId));
          return;
        }

        if (!deviceRef.current) {
          console.log(`[Mediasoup] Device not ready, queueing producer ${producerId}`);
          pendingProducersRef.current.push({ producerId, socketId, kind });
          return;
        }
        void consumeProducer(producerId, socketId, kind);
      });

      socket.on('participant:joined', (participant) => {
        setParticipants((current) => [
          ...current.filter((item) => item.id !== participant.socketId),
          { id: participant.socketId, displayName: participant.displayName, role: participant.role },
        ]);
      });

      socket.on('participant:left', (participant) => {
        setParticipants((current) => current.filter((item) => item.displayName !== participant.displayName));
        setRemoteTiles((current) => current.filter((tile) => tile.id !== participant.socketId));
      });

      socket.on('chat:receive', (message) => {
        setMessages((current) => [...current, message]);
      });

      socket.on('heartbeat:ping', () => {
        socket.emit('heartbeat:pong');
      });

      socket.on('recording:status', (status) => {
        setRecording(status.active);
        setError(null);
      });

      socket.on('room:force_mute', () => {
        localStreamRef.current?.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
        setMicEnabled(false);
      });

      socket.on('room:kicked', () => {
        setCallState('closed');
        cleanupCall();
        setError('You have been removed from the call by an admin.');
      });

      socket.on('room:closed', () => {
        setCallState('closed');
        cleanupCall();
      });

      socket.on('connect_error', (err) => {
        setError(err.message);
        setCallState('failed');
      });

      socket.on('error', (data) => {
        setError(data.message);
      });

      socket.on('disconnect', (reason) => {
        if (reason === 'io server disconnect' || reason === 'transport close') {
          setError('Lost connection to media server. Please refresh the page to reconnect.');
          setCallState('failed');
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to access camera or microphone');
      setCallState('failed');
    }
  }

  function cleanupCall(): void {
    socketRef.current?.disconnect();
    socketRef.current = null;
    producersRef.current.forEach((producer) => producer.close());
    consumersRef.current.forEach((consumer) => consumer.close());
    sendTransportRef.current?.close();
    recvTransportRef.current?.close();

    // Explicitly clear all refs to prevent stale state on reconnect/HMR
    producersRef.current = [];
    consumersRef.current = [];
    consumedProducersRef.current.clear();
    pendingProducersRef.current = [];
    sendTransportRef.current = null;
    recvTransportRef.current = null;
    recvTransportPromiseRef.current = null;

    if (telemetryIntervalRef.current) window.clearInterval(telemetryIntervalRef.current);
    telemetryIntervalRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
    screenProducerRef.current = null;
    setLocalStream(null);
    setScreenStream(null);
    setRemoteTiles([]);
  }


  function toggleMic(): void {
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !micEnabled;
    });
    setMicEnabled((value) => !value);
  }

  function toggleCamera(): void {
    localStream?.getVideoTracks().forEach((track) => {
      track.enabled = !cameraEnabled;
    });
    setCameraEnabled((value) => !value);
  }

  async function toggleScreenShare(): Promise<void> {
    if (screenStream) {
      // Close the mediasoup producer first — this signals the server and all consumers
      if (screenProducerRef.current) {
        screenProducerRef.current.close();
        producersRef.current = producersRef.current.filter((p) => p !== screenProducerRef.current);
        screenProducerRef.current = null;
      }
      screenStream.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
      return;
    }

    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = display;
      setScreenStream(display);
      const track = display.getVideoTracks()[0];

      // Handle user clicking "Stop sharing" in the browser's native UI
      track.addEventListener('ended', () => {
        if (screenProducerRef.current) {
          screenProducerRef.current.close();
          producersRef.current = producersRef.current.filter((p) => p !== screenProducerRef.current);
          screenProducerRef.current = null;
        }
        screenStreamRef.current = null;
        setScreenStream(null);
      });

      if (sendTransportRef.current && track) {
        const producer = await sendTransportRef.current.produce({ track, appData: { source: 'screen' } });
        screenProducerRef.current = producer;
        producersRef.current.push(producer);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') return;
      setError(err instanceof Error ? err.message : 'Unable to share screen');
    }
  }


  function endCall(): void {
    cleanupCall();
    navigate(user ? '/dashboard' : `/join/${sessionId}`, { replace: true });
  }

  function sendMessage(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const payload = messageDraft.trim();
    if (!payload) return;
    socketRef.current?.emit('chat:send', { payload, isFile: messageIsFile });
    setMessageDraft('');
    setMessageIsFile(false);
  }

  function toggleRecording(): void {
    if (!user || (user.role !== 'AGENT' && user.role !== 'ADMIN')) return;
    setRecordingBusy(true);
    const eventName = recording ? 'agent:stop_recording' : 'agent:start_recording';
    socketRef.current?.emit(eventName, (response) => {
      setRecordingBusy(false);
      if (!response.ok) {
        setError(response.error ?? 'Recording action failed');
        return;
      }
      setRecording(!recording);
    });
  }

  function endCallForAll(): void {
    if (!user || (user.role !== 'AGENT' && user.role !== 'ADMIN')) return;
    socketRef.current?.emit('agent:end_session', (response) => {
      if (!response.ok) setError(response.error ?? 'Failed to end session');
    });
  }

  function muteAll(): void {
    if (!user || (user.role !== 'AGENT' && user.role !== 'ADMIN')) return;
    socketRef.current?.emit('agent:mute_all', (response) => {
      if (!response.ok) setError(response.error ?? 'Failed to mute all');
    });
  }

  function removeParticipant(socketId: string): void {
    if (!user || (user.role !== 'AGENT' && user.role !== 'ADMIN')) return;
    socketRef.current?.emit('agent:remove_participant', { socketId }, (response) => {
      if (!response.ok) setError(response.error ?? 'Failed to remove participant');
    });
  }

  async function uploadChatFile(file: File): Promise<void> {
    if (!sessionId) return;
    setUploadingFile(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await api.upload<FileUploadResponse>(
        `/files/upload?sessionId=${encodeURIComponent(sessionId)}`,
        formData,
      );
      socketRef.current?.emit('chat:send', { payload: response.url, isFile: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload file');
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="grid min-h-svh grid-rows-[auto_1fr_auto] gap-3 p-3">
        <header className="flex flex-col gap-3 rounded-lg border bg-card/90 p-3 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
              <Video className="size-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-primary">Active Call</p>
              <h1 className="text-xl font-semibold tracking-tight">Session {sessionId.slice(0, 8)}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={callState === 'live' ? 'default' : 'secondary'} className="gap-2">
              {callState === 'connecting' ? <Loader2 className="size-3 animate-spin" /> : null}
              {callState}
            </Badge>
            <Button variant="outline" onClick={() => setDrawerOpen((value) => !value)} type="button">
              <MessageSquare />
              Drawer
            </Button>
          </div>
        </header>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section className={cn('grid min-h-0 gap-3', drawerOpen ? 'lg:grid-cols-[1fr_22rem]' : 'lg:grid-cols-1')}>
          <div className="grid min-h-0 grid-cols-1 content-center gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {allTiles.length > 0 ? allTiles.map((tile) => <VideoTile key={tile.id} tile={tile} />) : (
              <Card className="col-span-full min-h-80">
                <CardContent className="grid h-full place-items-center p-8 text-center">
                  <div>
                    <Loader2 className="mx-auto mb-4 size-10 animate-spin text-primary" />
                    <p className="font-medium">Starting secure media</p>
                    <p className="mt-1 text-sm text-muted-foreground">Camera, microphone, and SFU transports are connecting.</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {drawerOpen ? (
            <aside className="grid min-h-0 grid-rows-[auto_1fr] gap-3">
              <Card className="py-4">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Users className="size-4" />
                      Participants
                    </CardTitle>
                    {user?.role === 'AGENT' || user?.role === 'ADMIN' ? (
                      <Button variant="outline" size="sm" onClick={muteAll} title="Mute everyone in the call">Mute All</Button>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="grid gap-2">
                  <Badge variant="secondary" className="justify-start">{displayName} (you)</Badge>
                  {participants.map((participant) => (
                    <div key={participant.id} className="flex items-center gap-2">
                      <Badge variant="outline" className="flex-1 justify-start">
                        {participant.displayName} - {participant.role}
                      </Badge>
                      {user?.role === 'AGENT' || user?.role === 'ADMIN' ? (
                        <Button variant="ghost" size="icon" className="size-6 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground" onClick={() => removeParticipant(participant.id)} title="Remove participant">
                          <X className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="min-h-0 py-4">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MessageSquare className="size-4" />
                    Chat
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid min-h-0 grid-rows-[1fr_auto] gap-3">
                  <div className="grid max-h-[45vh] content-start gap-2 overflow-auto rounded-lg border bg-background/40 p-3">
                    {messages.length > 0 ? messages.map((message) => (
                      <ChatMessageBubble key={message.id} message={message} />
                    )) : <p className="text-sm text-muted-foreground">No messages yet.</p>}
                  </div>
                  <form className="grid gap-2" onSubmit={sendMessage}>
                    <div className="flex gap-2">
                      <Input value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} placeholder={messageIsFile ? 'Paste file URL...' : 'Message...'} />
                      <Button size="icon" type="submit" aria-label="Send message"><Send /></Button>
                    </div>
                    <input
                      ref={fileInputRef}
                      className="hidden"
                      type="file"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadChatFile(file);
                      }}
                    />
                    <Button
                      className="justify-start"
                      variant="secondary"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingFile}
                      type="button"
                    >
                      {uploadingFile ? <Loader2 className="animate-spin" /> : <FileUp />}
                      {uploadingFile ? 'Uploading file' : 'Upload file'}
                    </Button>
                    <Button
                      className="justify-start"
                      variant={messageIsFile ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setMessageIsFile((value) => !value)}
                      type="button"
                    >
                      <FileText />
                      {messageIsFile ? 'Sending as file link' : 'Mark as file link'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </aside>
          ) : null}
        </section>

        <footer className="mx-auto flex w-full max-w-2xl items-center justify-center gap-2 rounded-lg border bg-card/95 p-3 shadow-2xl backdrop-blur">
          <Button variant={micEnabled ? 'secondary' : 'destructive'} size="icon" onClick={toggleMic} type="button" aria-label="Toggle microphone">
            {micEnabled ? <Mic /> : <MicOff />}
          </Button>
          <Button variant={cameraEnabled ? 'secondary' : 'destructive'} size="icon" onClick={toggleCamera} type="button" aria-label="Toggle camera">
            {cameraEnabled ? <Camera /> : <CameraOff />}
          </Button>
          <Button variant={screenStream ? 'default' : 'secondary'} size="icon" onClick={() => void toggleScreenShare()} type="button" aria-label="Share screen">
            <MonitorUp />
          </Button>
          {user?.role === 'AGENT' || user?.role === 'ADMIN' ? (
            <>
              <Button variant={recording ? 'default' : 'secondary'} onClick={toggleRecording} disabled={recordingBusy} type="button">
                {recordingBusy ? <Loader2 className="animate-spin" /> : <Radio />}
                {recording ? 'Stop recording' : 'Record'}
              </Button>
              <Button variant="destructive" onClick={endCallForAll} type="button" title="End call for everyone">
                <PhoneOff />
                End for all
              </Button>
            </>
          ) : null}
          <Button variant={user?.role === 'AGENT' || user?.role === 'ADMIN' ? 'secondary' : 'destructive'} onClick={endCall} type="button" title="Leave call">
            <PhoneOff />
            Leave
          </Button>
        </footer>
      </div>
    </main>
  );
}

export default CallRoom;
