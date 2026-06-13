import { Router, Request, Response } from 'express';
import redis from '../config/redis';
import { requireAuth, requireRole } from '../middleware/auth.middleware';

const router = Router();

async function ensureRedis(): Promise<void> {
  if (redis.status === 'wait') await redis.connect();
}

router.use(requireAuth, requireRole('ADMIN'));

router.get('/active-sessions', async (_req: Request, res: Response): Promise<void> => {
  try {
    await ensureRedis();
    const sessionIds = await redis.smembers('active:sessions');
    const sessions = await Promise.all(sessionIds.map(async (sessionId) => {
      const participantKeys = await redis.smembers(`active:session:${sessionId}:participants`);
      const participants = await Promise.all(participantKeys.map(async (participantKey) => {
        const data = await redis.hgetall(participantKey);
        return {
          socketId: data.socketId,
          userId: data.userId,
          displayName: data.displayName,
          role: data.role,
          joinedAt: data.joinedAt,
        };
      }));

      return {
        id: sessionId,
        participants,
        participantCount: participants.length,
      };
    }));

    res.json({ data: sessions });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
