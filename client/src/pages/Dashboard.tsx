import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Clipboard,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/context/AuthContext';
import type { CreateSessionResponse, Session, SessionHistoryResponse, SessionStatus } from '@/types';

const PAGE_SIZE = 8;

function formatDate(value?: string | null): string {
  if (!value) return 'Not started';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds < 1) return '0m';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 1) return `${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 1) return `${minutes}m ${remainingSeconds}s`;
  return `${hours}h ${remainingMinutes}m`;
}

function StatusBadge({ status }: { status: SessionStatus }): React.ReactElement {
  const tone = {
    WAITING: 'border-amber-400/35 bg-amber-400/10 text-amber-100',
    ACTIVE: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-100',
    ENDED: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  }[status];

  return <Badge variant="outline" className={tone}>{status}</Badge>;
}

function Dashboard(): React.ReactElement {
  const { user, logout } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function endSession(sessionId: string): Promise<void> {
    const confirmed = window.confirm(`End session ${sessionId}?`);
    if (!confirmed) return;

    try {
      await api.post(`/sessions/${sessionId}/end`);
      await loadHistory(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to end session');
    }
  }

  const activeCount = useMemo(
    () => sessions.filter((session) => session.status === 'ACTIVE' || session.status === 'WAITING').length,
    [sessions],
  );
  const totalParticipants = useMemo(
    () => sessions.reduce((sum, session) => sum + (session.participants?.length ?? 0), 0),
    [sessions],
  );
  const metrics: Array<[string, number, LucideIcon]> = [
    ['Open Sessions', activeCount, Video],
    ['Loaded Records', sessions.length, Clipboard],
    ['Participants', totalParticipants, Users],
  ];

  async function loadHistory(targetPage = page): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const response = await api.get<SessionHistoryResponse>(
        `/sessions/history?page=${targetPage}&limit=${PAGE_SIZE}`,
      );
      setSessions(response.data);
      setPage(response.meta.page);
      setTotalPages(Math.max(1, response.meta.totalPages));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load sessions');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    document.title = 'Agent Dashboard - AtomQuest';
    void loadHistory(1);
  }, []);

  async function handleCreateSession(): Promise<void> {
    setCreating(true);
    setCopyState('idle');
    setError(null);

    try {
      const response = await api.post<CreateSessionResponse>('/sessions');
      setInviteUrl(response.inviteUrl);
      await loadHistory(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create session');
    } finally {
      setCreating(false);
    }
  }

  async function copyInvite(): Promise<void> {
    if (!inviteUrl) return;

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto grid w-full max-w-7xl gap-4 p-3 sm:p-6">
        <Card className="border-border/80 bg-card/90 py-4 shadow-xl backdrop-blur">
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
                <Video className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-primary">Support Operations</p>
                <h1 className="truncate text-2xl font-semibold tracking-tight">Agent Dashboard</h1>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <Badge variant="outline" className="h-9 max-w-full justify-start gap-2 px-3">
                <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_16px_theme(colors.emerald.400)]" />
                <span className="truncate">{user?.email}</span>
              </Badge>
              <Button variant="outline" onClick={logout} type="button">
                <LogOut />
                Sign out
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-border/80 bg-card/90 shadow-xl backdrop-blur">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[linear-gradient(110deg,transparent,hsl(var(--primary)/0.16),transparent)] animate-sweep" />
          <CardHeader className="relative gap-5 lg:flex lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <CardDescription className="font-semibold uppercase text-primary">Live Console</CardDescription>
              <CardTitle className="mt-1 text-3xl leading-tight tracking-tight sm:text-5xl">
                Create invite links and review session history.
              </CardTitle>
            </div>
            <Button className="h-11 shadow-lg shadow-primary/20 animate-soft-pulse" disabled={creating} onClick={handleCreateSession} type="button">
              {creating ? <Loader2 className="animate-spin" /> : <Plus />}
              {creating ? 'Generating' : 'Generate New Session'}
            </Button>
          </CardHeader>
        </Card>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {inviteUrl ? (
          <Card className="border-primary/25 bg-primary/5 py-4 animate-rise-in">
            <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-primary">Customer Invite</p>
                <a className="mt-1 block break-all text-sm text-primary hover:underline" href={inviteUrl} target="_blank" rel="noreferrer">
                  {inviteUrl}
                </a>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={copyInvite} type="button">
                  {copyState === 'copied' ? <Check /> : <Copy />}
                  {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Select link' : 'Copy link'}
                </Button>
                <Button variant="outline" asChild>
                  <a href={inviteUrl} target="_blank" rel="noreferrer">
                    <ExternalLink />
                    Open
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3" aria-label="Session metrics">
          {metrics.map(([label, value, Icon]) => (
            <Card key={String(label)} className="overflow-hidden border-border/80 bg-card/90 py-5 shadow-lg">
              <CardContent className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{label as string}</p>
                  <p className="mt-2 text-4xl font-semibold tracking-tight">{value as number}</p>
                </div>
                <div className="grid size-11 place-items-center rounded-md bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <Card className="border-border/80 bg-card/90 shadow-xl">
          <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardDescription className="font-semibold uppercase text-primary">History</CardDescription>
              <CardTitle className="text-2xl">Recent sessions</CardTitle>
            </div>
            <Button variant="outline" disabled={loading} onClick={() => void loadHistory(page)} type="button">
              <RefreshCw className={loading ? 'animate-spin' : undefined} />
              Refresh
            </Button>
          </CardHeader>

          <CardContent>
            <div className="grid min-h-56 gap-3" aria-busy={loading}>
              {loading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton className="h-[74px] w-full" key={index} />
                ))
              ) : sessions.length > 0 ? (
                sessions.map((session) => {
                  const participants = session.participants ?? [];
                  const totalDuration = participants.reduce((sum, participant) => sum + (participant.duration_seconds ?? 0), 0);

                  return (
                    <article
                      className="group flex flex-col gap-4 rounded-lg border bg-background/45 p-4 transition-all hover:-translate-y-0.5 hover:border-border/90 hover:bg-accent/40 sm:flex-row sm:items-center sm:justify-between"
                      key={session.id}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <StatusBadge status={session.status} />
                        <div className="min-w-0">
                          <h3 className="truncate font-medium">{session.id}</h3>
                          <p className="text-sm text-muted-foreground">
                            {formatDate(session.created_at ?? session.start_time)} - {participants.length} participant{participants.length === 1 ? '' : 's'}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
                        <span>{formatDuration(totalDuration)}</span>
                        {session.recording_url ? (
                          <Button variant="secondary" size="sm" asChild>
                            <a href={session.recording_url} target="_blank" rel="noreferrer">
                              <Video className="size-4" />
                              Recording
                            </a>
                          </Button>
                        ) : null}
                        <Button variant="secondary" size="sm" asChild>
                          <a href={`/join/${session.id}`} target="_blank" rel="noreferrer">
                            <ExternalLink className="size-4" />
                            Invite
                          </a>
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                          <a href={`/call/${session.id}`}>
                            <Video className="size-4" />
                            Call
                          </a>
                        </Button>
                        {session.status !== 'ENDED' ? (
                          <Button variant="destructive" size="sm" onClick={() => void endSession(session.id)}>
                            End Session
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="grid min-h-56 place-items-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
                  <div>
                    <h3 className="font-semibold">No sessions yet</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Generate the first customer invite to start filling the history feed.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <Separator className="my-5" />

            <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-end">
              <Button
                variant="outline"
                disabled={loading || page <= 1}
                onClick={() => void loadHistory(page - 1)}
                type="button"
              >
                Previous
              </Button>
              <span className="text-center">Page {page} of {totalPages}</span>
              <Button
                variant="outline"
                disabled={loading || page >= totalPages}
                onClick={() => void loadHistory(page + 1)}
                type="button"
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default Dashboard;
