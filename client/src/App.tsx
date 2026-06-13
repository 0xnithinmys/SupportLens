import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Dashboard from './pages/Dashboard';
import JoinRoom from './pages/JoinRoom';
import Login from './pages/Login';

const CallRoom = lazy(() => import('./pages/CallRoom'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));

function AppLoader(): React.ReactElement {
  return (
    <main className="grid min-h-svh place-items-center bg-background p-6 text-foreground">
      <div className="flex items-center gap-3 rounded-lg border bg-card px-5 py-4 shadow-xl" aria-label="Loading AtomQuest">
        <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <span>Preparing workspace</span>
      </div>
    </main>
  );
}

function ProtectedRoute({ children }: { children: React.ReactElement }): React.ReactElement {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <AppLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return children;
}

function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/join/:sessionId" element={<JoinRoom />} />
        <Route
          path="/call/:sessionId"
          element={(
            <Suspense fallback={<AppLoader />}>
              <CallRoom />
            </Suspense>
          )}
        />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/dashboard"
          element={(
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/admin"
          element={(
            <ProtectedRoute>
              <Suspense fallback={<AppLoader />}>
                <AdminDashboard />
              </Suspense>
            </ProtectedRoute>
          )}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
