import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, Loader2, Mic, PlugZap, ShieldCheck, Video, Wifi, WifiOff } from 'lucide-react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { ParticipantRole } from '@/types';

type CheckState = 'idle' | 'checking' | 'ready' | 'failed';
type ConnectionState = 'idle' | 'connecting' | 'waiting' | 'agent-ready' | 'closed' | 'failed';

interface ServerToClientEvents {
  'room:closed': () => void;
  'participant:joined': (data: { displayName: string; role: ParticipantRole | 'ADMIN'; socketId: string }) => void;
  'participant:left': (data: { displayName: string; role: ParticipantRole | 'ADMIN' }) => void;
  'router:capabilities': (data: { rtpCapabilities: unknown }) => void;
  error: (data: { message: string }) => void;
}

interface ClientToServerEvents {
  'room:join': (data: { sessionId: string; displayName?: string }) => void;
}

type WaitingSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function isSessionId(value: string | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function JoinRoom(): React.ReactElement {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('Customer');
  const [checkState, setCheckState] = useState<CheckState>('idle');
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<WaitingSocket | null>(null);

  const isReady = checkState === 'ready';
  const statusCopy = useMemo(() => {
    if (connectionState === 'agent-ready') return 'Agent connected';
    if (connectionState === 'waiting') return 'Waiting for agent';
    if (connectionState === 'connecting') return 'Connecting';
    if (connectionState === 'closed') return 'Session closed';
    if (connectionState === 'failed') return 'Connection failed';
    return 'Pre-flight';
  }, [connectionState]);

  useEffect(() => {
    document.title = 'Join Session - AtomQuest';

    const handleUnload = (): void => {
      socketRef.current?.disconnect();
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      socketRef.current?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  if (!isSessionId(sessionId)) {
    return <Navigate to="/login" replace />;
  }

  async function runHardwareCheck(): Promise<void> {
    setCheckState('checking');
    setPermissionError(null);

    try {
      stream?.getTracks().forEach((track) => track.stop());
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
      });
      setStream(media);
      setCheckState('ready');
    } catch (err) {
      setCheckState('failed');
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setPermissionError('Camera or microphone permission was blocked. Allow access in the browser prompt, then run the check again.');
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setPermissionError('No camera or microphone was found. Connect a device, then run the check again.');
      } else {
        setPermissionError(err instanceof Error ? err.message : 'Unable to access camera or microphone.');
      }
    }
  }

  function joinWaitingRoom(): void {
    if (!isReady || !sessionId) return;

    socketRef.current?.disconnect();
    setSocketError(null);
    setConnectionState('connecting');

    const socket: WaitingSocket = io('/', {
      auth: {
        sessionId,
        displayName: displayName.trim() || 'Customer',
      },
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('room:join', { sessionId, displayName: displayName.trim() || 'Customer' });
      setConnectionState('waiting');
    });

    socket.on('router:capabilities', () => {
      setConnectionState((current) => (current === 'agent-ready' ? current : 'waiting'));
    });

    socket.on('participant:joined', (participant) => {
      if (participant.role === 'AGENT' || participant.role === 'ADMIN') {
        setAgentName(participant.displayName);
        setConnectionState('agent-ready');
      }
    });

    socket.on('participant:left', (participant) => {
      if (participant.role === 'AGENT' || participant.role === 'ADMIN') {
        setAgentName(null);
        setConnectionState('waiting');
      }
    });

    socket.on('room:closed', () => {
      setConnectionState('closed');
      socket.disconnect();
    });

    socket.on('connect_error', (err) => {
      setSocketError(err.message);
      setConnectionState('failed');
    });

    socket.on('error', (data) => {
      setSocketError(data.message);
      setConnectionState('failed');
    });
  }

  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto grid min-h-svh w-full max-w-7xl gap-4 p-3 sm:p-6 lg:grid-cols-[1.08fr_0.92fr]">
        <section className="grid content-center gap-4">
          <Card className="relative overflow-hidden border-border/80 bg-card/90 shadow-2xl backdrop-blur">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-chart-4 to-chart-5" />
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Badge variant="outline" className="gap-2 border-primary/30 bg-primary/10 text-primary">
                  <ShieldCheck className="size-3.5" />
                  Ephemeral session access
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    'gap-2',
                    connectionState === 'agent-ready' && 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100',
                    connectionState === 'failed' && 'border-destructive/40 bg-destructive/10 text-destructive',
                  )}
                >
                  {connectionState === 'failed' ? <WifiOff className="size-3.5" /> : <Wifi className="size-3.5" />}
                  {statusCopy}
                </Badge>
              </div>
              <CardTitle className="text-3xl leading-tight tracking-tight sm:text-5xl">
                Check your camera and microphone before joining.
              </CardTitle>
              <CardDescription>
                No login is required. This invite link is the temporary access token for your support session.
              </CardDescription>
            </CardHeader>

            <CardContent className="grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="displayName">Display name</Label>
                <Input
                  id="displayName"
                  maxLength={60}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Customer"
                  value={displayName}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-background/45 p-4">
                  <Camera className="mb-3 size-5 text-primary" />
                  <p className="font-medium">Camera</p>
                  <p className="text-sm text-muted-foreground">Preview confirms video access.</p>
                </div>
                <div className="rounded-lg border bg-background/45 p-4">
                  <Mic className="mb-3 size-5 text-primary" />
                  <p className="font-medium">Microphone</p>
                  <p className="text-sm text-muted-foreground">Audio permission is checked.</p>
                </div>
                <div className="rounded-lg border bg-background/45 p-4">
                  <PlugZap className="mb-3 size-5 text-primary" />
                  <p className="font-medium">Waiting room</p>
                  <p className="text-sm text-muted-foreground">Connects only after checks pass.</p>
                </div>
              </div>

              {permissionError ? (
                <Alert variant="destructive">
                  <AlertTitle>Hardware check failed</AlertTitle>
                  <AlertDescription>{permissionError}</AlertDescription>
                </Alert>
              ) : null}

              {socketError ? (
                <Alert variant="destructive">
                  <AlertTitle>Waiting room error</AlertTitle>
                  <AlertDescription>{socketError}</AlertDescription>
                </Alert>
              ) : null}

              {connectionState === 'agent-ready' ? (
                <Alert className="border-emerald-400/30 bg-emerald-400/10">
                  <Check className="size-4 text-emerald-300" />
                  <AlertTitle>Your agent is connected</AlertTitle>
                  <AlertDescription>
                    {agentName ? `${agentName} is ready.` : 'The agent is ready.'} The active call screen arrives in the next task.
                  </AlertDescription>
                </Alert>
              ) : null}

              <Separator />

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button className="h-11" variant="secondary" onClick={() => void runHardwareCheck()} disabled={checkState === 'checking'} type="button">
                  {checkState === 'checking' ? <Loader2 className="animate-spin" /> : <Video />}
                  {checkState === 'ready' ? 'Run check again' : 'Run hardware check'}
                </Button>
                <Button className="h-11 shadow-lg shadow-primary/20" onClick={joinWaitingRoom} disabled={!isReady || connectionState === 'connecting'} type="button">
                  {connectionState === 'connecting' ? <Loader2 className="animate-spin" /> : <Wifi />}
                  Join waiting room
                </Button>
                <Button
                  className="h-11"
                  variant="outline"
                  onClick={() => navigate(`/call/${sessionId}?name=${encodeURIComponent(displayName.trim() || 'Customer')}`)}
                  disabled={connectionState !== 'agent-ready'}
                  type="button"
                >
                  <Video />
                  Enter call
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid content-center">
          <Card className="overflow-hidden border-border/80 bg-card/90 py-0 shadow-2xl backdrop-blur">
            <div className="relative aspect-video bg-muted">
              {stream ? (
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-full w-full scale-x-[-1] object-cover"
                />
              ) : (
                <div className="grid h-full place-items-center p-8 text-center">
                  <div>
                    <div className="mx-auto mb-4 grid size-16 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Camera className="size-8" />
                    </div>
                    <h2 className="text-xl font-semibold">Camera preview appears here</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Your browser will ask for camera and microphone permission when you run the check.
                    </p>
                  </div>
                </div>
              )}
              <div className="absolute left-3 top-3">
                <Badge variant="outline" className="border-background/30 bg-background/65 text-foreground backdrop-blur">
                  {checkState === 'ready' ? 'Preview live' : 'Preview idle'}
                </Badge>
              </div>
            </div>
            <CardContent className="grid gap-3 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">Session token</p>
                  <p className="max-w-[28rem] truncate text-sm text-muted-foreground">{sessionId}</p>
                </div>
                <Badge variant={checkState === 'ready' ? 'default' : 'secondary'}>
                  {checkState === 'ready' ? 'Ready' : 'Needs check'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

export default JoinRoom;
