import './config/env';
import http from 'http';
import app from './app';
import { initSocket } from './socket';
import { createWorkers } from './config/mediasoup';

const PORT = process.env.PORT ?? 4000;

async function bootstrap(): Promise<void> {
  // Boot Mediasoup C++ workers before accepting any connections
  await createWorkers();

  const server = http.createServer(app);
  initSocket(server);

  server.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
    console.log(`[Server] Environment: ${process.env.NODE_ENV}`);
  });
}

bootstrap().catch((err: Error) => {
  console.error('[Server] Fatal startup error:', err.message);
  process.exit(1);
});
