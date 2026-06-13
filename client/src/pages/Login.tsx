import { FormEvent, useEffect, useState } from 'react';
import { ArrowRight, Loader2, LockKeyhole, RadioTower } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/context/AuthContext';

function Login(): React.ReactElement {
  const navigate = useNavigate();
  const { login, isAuthenticated, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Agent Login - AtomQuest';
  }, []);

  if (!isLoading && isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email, password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-svh overflow-hidden bg-background text-foreground lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden min-h-svh place-items-center overflow-hidden border-r border-border/70 bg-muted/20 lg:grid">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:44px_44px] opacity-70 [mask-image:linear-gradient(to_right,#000_44%,transparent_92%)]" />
        <div className="relative aspect-square w-[min(62vw,34rem)]">
          <span className="absolute inset-[12%] rounded-full border border-primary/30 animate-breathe" />
          <span className="absolute inset-[27%] rounded-full border border-chart-4/30 animate-breathe [animation-delay:-1.4s]" />
          <span className="absolute left-[18%] top-[28%] size-3.5 rounded-full bg-primary shadow-[0_0_28px_hsl(var(--primary)/0.55)] animate-float-a" />
          <span className="absolute right-[19%] top-[22%] size-3.5 rounded-full bg-chart-4 shadow-[0_0_28px_hsl(var(--chart-4)/0.45)] animate-float-b" />
          <span className="absolute bottom-[19%] left-[46%] size-3.5 rounded-full bg-chart-5 shadow-[0_0_28px_hsl(var(--chart-5)/0.45)] animate-float-c" />
          <div className="absolute left-[24%] top-[31%] h-[38%] w-[46%] rounded-lg border border-border/80 bg-card/60 shadow-2xl backdrop-blur-xl animate-drift">
            <div className="flex h-full items-center justify-center">
              <RadioTower className="size-14 text-primary/80" />
            </div>
          </div>
          <div className="absolute bottom-[18%] right-[17%] h-[19%] w-[26%] rounded-lg border border-border/80 bg-card/60 shadow-2xl backdrop-blur-xl animate-drift-reverse" />
        </div>
      </section>

      <section className="grid min-h-svh place-items-center p-4 sm:p-8">
        <Card className="w-full max-w-md border-border/80 bg-card/90 shadow-2xl backdrop-blur">
          <CardHeader className="gap-4">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-md bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                <LockKeyhole className="size-5" />
              </div>
              <div>
                <CardDescription className="font-semibold uppercase text-primary">Agent Console</CardDescription>
                <CardTitle className="text-3xl">AtomQuest</CardTitle>
              </div>
            </div>
            <CardDescription>
              Sign in to generate customer invite links and review support sessions.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form className="grid gap-5" onSubmit={handleSubmit}>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  autoComplete="email"
                  inputMode="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="agent@atomquest.dev"
                  required
                  type="email"
                  value={email}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  required
                  type="password"
                  value={password}
                />
              </div>

              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <Button className="h-11 shadow-lg shadow-primary/20" disabled={submitting} type="submit">
                {submitting ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                {submitting ? 'Signing in' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

export default Login;
