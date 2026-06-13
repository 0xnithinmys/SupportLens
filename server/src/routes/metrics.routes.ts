import { Router, Request, Response } from 'express';
import redis from '../config/redis';
import { renderPrometheusMetrics } from '../services/metrics';

const router = Router();

async function ensureRedis(): Promise<void> {
  if (redis.status === 'wait') await redis.connect();
}

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    await ensureRedis();
    const sessionIds = await redis.smembers('active:sessions');
    let participantCount = 0;
    for (const sessionId of sessionIds) {
      participantCount += await redis.scard(`active:session:${sessionId}:participants`);
    }

    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(renderPrometheusMetrics(sessionIds.length, participantCount));
  } catch (err) {
    res.status(500).send(`# metrics_error ${(err as Error).message}\n`);
  }
});

export default router;
