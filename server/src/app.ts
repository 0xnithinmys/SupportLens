import './config/env';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import adminRoutes from './routes/admin.routes';
import authRoutes from './routes/auth.routes';
import fileRoutes from './routes/files.routes';
import metricsRoutes from './routes/metrics.routes';
import sessionRoutes from './routes/sessions.routes';
import { logSecurityEvent } from './services/security';

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use((req: Request, res: Response, next: NextFunction) => {
  const enforceTls = process.env.NODE_ENV === 'production' && process.env.ENFORCE_TLS !== 'false';
  const proto = req.headers['x-forwarded-proto'];
  if (enforceTls && proto && proto !== 'https') {
    void logSecurityEvent('tls_rejected', 'Rejected non-HTTPS request behind proxy', {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    res.status(403).json({ error: 'HTTPS is required' });
    return;
  }
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/files',    fileRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/metrics',      metricsRoutes);

// ── Local recording fallback (when S3 upload is unavailable) ──────────────
// Serves files from the local recordings directory so agents can download
// recordings even when cloud storage is not configured.
const recordingRoot = process.env.RECORDING_DIR ?? path.join(__dirname, '..', 'recordings');
app.use('/api/recordings', express.static(recordingRoot, { fallthrough: false }));

// ── 404 handler ───────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ───────────────────────────────────────────────────
app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err.message);
  res.status(err.status ?? 500).json({ error: err.message ?? 'Internal server error' });
});

export default app;
