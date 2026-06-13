import { useEffect, useState } from 'react';
import { Shield, SquareX, RefreshCw, Users } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { api } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';

interface ActiveParticipant {
  socketId: string;
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string;
}

interface ActiveSession {
  id: string;
  participantCount: number;
  participants: ActiveParticipant[];
}

interface ActiveSessionsResponse {
  data: ActiveSession[];
}

function AdminDashboard(): React.ReactElement {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadSessions(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const response = await api.get<ActiveSessionsResponse>('/admin/active-sessions');
      setSessions(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load active sessions');
    } finally {
      setLoading(false);
    }
  }

  async function terminateSession(sessionId: string): Promise<void> {
    const confirmed = window.confirm(`Force terminate session ${sessionId}?`);
    if (!confirmed) return;

    try {
      await api.post(`/sessions/${sessionId}/end`);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to terminate session');
    }
  }

  useEffect(() => {
    document.title = 'Admin Dashboard - AtomQuest';
    void loadSessions();
    const interval = window.setInterval(() => void loadSessions(), 5000);
    return () => window.clearInterval(interval);
  }, []);

  if (user?.role !== 'ADMIN') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <main className="min-h-svh bg-background p-3 text-foreground sm:p-6">
      <div className="mx-auto grid max-w-7xl gap-4">
        <Card className="border-border/80 bg-card/90 shadow-xl">
          <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-md bg-primary text-primary-foreground">
                <Shield className="size-5" />
              </div>
              <div>
                <CardDescription className="font-semibold uppercase text-primary">Redis State Store</CardDescription>
                <CardTitle className="text-3xl">Admin Dashboard</CardTitle>
              </div>
            </div>
            <Button variant="outline" disabled={loading} onClick={() => void loadSessions()} type="button">
              <RefreshCw className={loading ? 'animate-spin' : undefined} />
              Refresh
            </Button>
          </CardHeader>
        </Card>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-4">
          {sessions.length > 0 ? sessions.map((session) => (
            <Card key={session.id} className="border-border/80 bg-card/90 shadow-lg">
              <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant="secondary" className="gap-2">
                      <Users className="size-3.5" />
                      {session.participantCount} participant{session.participantCount === 1 ? '' : 's'}
                    </Badge>
                  </div>
                  <CardTitle className="break-all text-xl">{session.id}</CardTitle>
                  <CardDescription>Active sockets from Redis state.</CardDescription>
                </div>
                <Button variant="destructive" onClick={() => void terminateSession(session.id)} type="button">
                  <SquareX />
                  Force terminate
                </Button>
              </CardHeader>
              <CardContent className="grid gap-2">
                {session.participants.map((participant) => (
                  <div key={participant.socketId} className="flex flex-col gap-1 rounded-lg border bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{participant.displayName}</p>
                      <p className="text-sm text-muted-foreground">{participant.socketId}</p>
                    </div>
                    <Badge variant="outline">{participant.role}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )) : (
            <Card className="border-dashed bg-card/70">
              <CardContent className="grid min-h-56 place-items-center p-8 text-center">
                <div>
                  <p className="font-semibold">No active sessions</p>
                  <p className="mt-1 text-sm text-muted-foreground">Redis does not currently report any live call rooms.</p>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}

export default AdminDashboard;
