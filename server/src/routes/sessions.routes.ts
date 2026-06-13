/**
 * sessions.routes.ts
 * -------------------
 * POST /api/sessions           → create session, return invite URL  (AGENT)
 * POST /api/sessions/:id/end   → terminate session, broadcast close (AGENT | ADMIN)
 * GET  /api/sessions/history   → paginated history with durations   (AGENT | ADMIN)
 * GET  /api/sessions/:id       → single session detail              (AGENT | ADMIN)
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/db';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { stopRecording } from '../services/recording';
import type { Session, Participant, ChatMessage } from '../types';

const router = Router();

// All session routes require a valid JWT
router.use(requireAuth);

// ── POST /api/sessions ───────────────────────────────────────────────────────
// Creates a new WAITING session and returns the shareable invite URL.
router.post(
  '/',
  requireRole('AGENT', 'ADMIN'),
  async (_req: Request, res: Response): Promise<void> => {
    const agentId = res.locals.user.sub;

    try {
      const sessionId = uuidv4();

      await query(
        `INSERT INTO sessions (id, agent_id, status) VALUES ($1, $2, 'WAITING')`,
        [sessionId, agentId],
      );

      const inviteUrl = `${process.env.CLIENT_URL ?? 'http://localhost:5173'}/join/${sessionId}`;

      res.status(201).json({
        session: { id: sessionId, agentId, status: 'WAITING' },
        inviteUrl,
      });
    } catch (err) {
      console.error('[Sessions] Create error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to create session' });
    }
  },
);

// ── GET /api/sessions/history ────────────────────────────────────────────────
// Returns paginated sessions with per-participant duration in seconds.
// Must be declared BEFORE /:id to avoid route shadowing.
router.get(
  '/history',
  requireRole('AGENT', 'ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    const agentId = res.locals.user.sub;
    const role = res.locals.user.role;
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) ?? '20', 10)));
    const offset = (page - 1) * limit;

    try {
      // Admins see all sessions; agents see only their own
      const sessionWhere = role === 'ADMIN' ? '' : 'WHERE s.agent_id = $3';
      const countParams: unknown[] = role === 'ADMIN' ? [limit, offset] : [limit, offset, agentId];

      const { rows: sessions } = await query<
        Session & { agent_email: string; total_count: string }
      >(
        `SELECT
           s.id,
           s.agent_id,
           s.status,
           s.start_time,
           s.end_time,
           s.recording_url,
           s.created_at,
           u.email AS agent_email,
           COUNT(*) OVER() AS total_count
         FROM sessions s
         JOIN users u ON u.id = s.agent_id
         ${sessionWhere}
         ORDER BY s.created_at DESC
         LIMIT $1 OFFSET $2`,
        countParams,
      );

      const total = parseInt(sessions[0]?.total_count ?? '0', 10);

      // Fetch participants for each session in one query
      const sessionIds = sessions.map((s) => s.id);
      let participants: Participant[] = [];

      if (sessionIds.length > 0) {
        const placeholders = sessionIds.map((_, i) => `$${i + 1}`).join(', ');
        const { rows } = await query<Participant>(
          `SELECT
             id, session_id, display_name, role, joined_at, left_at,
             EXTRACT(EPOCH FROM (COALESCE(left_at, NOW()) - joined_at))::int AS duration_seconds
           FROM participants
           WHERE session_id IN (${placeholders})
           ORDER BY joined_at ASC`,
          sessionIds,
        );
        participants = rows;
      }

      // Group participants by session
      const participantMap = participants.reduce<Record<string, Participant[]>>((acc, p) => {
        (acc[p.session_id] ??= []).push(p);
        return acc;
      }, {});

      const data = sessions.map(({ total_count: _tc, ...s }) => ({
        ...s,
        participants: participantMap[s.id] ?? [],
      }));

      res.json({
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (err) {
      console.error('[Sessions] History error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to fetch session history' });
    }
  },
);

// ── GET /api/sessions/:id ────────────────────────────────────────────────────
// Returns a single session with participants and chat messages.
router.get(
  '/:id',
  requireRole('AGENT', 'ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const agentId = res.locals.user.sub;
    const role = res.locals.user.role;

    try {
      const { rows } = await query<Session>(
        `SELECT * FROM sessions WHERE id = $1`,
        [id],
      );
      const session = rows[0];

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      // Agents can only view their own sessions
      if (role === 'AGENT' && session.agent_id !== agentId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const { rows: participants } = await query<Participant>(
        `SELECT *, EXTRACT(EPOCH FROM (COALESCE(left_at, NOW()) - joined_at))::int AS duration_seconds
         FROM participants WHERE session_id = $1 ORDER BY joined_at ASC`,
        [id],
      );

      const { rows: messages } = await query<ChatMessage>(
        `SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY timestamp ASC`,
        [id],
      );

      res.json({ session, participants, messages });
    } catch (err) {
      console.error('[Sessions] Get error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to fetch session' });
    }
  },
);

// ── POST /api/sessions/:id/recording ─────────────────────────────────────────
// Saves a client-side uploaded recording URL to the session
router.post(
  '/:id/recording',
  requireRole('AGENT', 'ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    const { url } = req.body as { url?: string };
    const agentId = res.locals.user.sub;
    const role = res.locals.user.role;

    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'Valid URL is required' });
      return;
    }

    try {
      const { rows } = await query<Session>(
        `SELECT * FROM sessions WHERE id = $1`,
        [id],
      );
      const session = rows[0];

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      if (role === 'AGENT' && session.agent_id !== agentId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      await query(
        `UPDATE sessions SET recording_url = $2 WHERE id = $1`,
        [id, url],
      );

      res.json({ message: 'Recording URL saved', url });
    } catch (err) {
      console.error('[Sessions] Save recording error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to save recording URL' });
    }
  },
);

// ── POST /api/sessions/:id/end ───────────────────────────────────────────────
router.post(
  '/:id/end',
  requireRole('AGENT', 'ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    const agentId = res.locals.user.sub;
    const role = res.locals.user.role;

    try {
      const { rows } = await query<Session>(
        `SELECT * FROM sessions WHERE id = $1`,
        [id],
      );
      const session = rows[0];

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      if (session.status === 'ENDED') {
        res.status(409).json({ error: 'Session already ended' });
        return;
      }

      // Agents can only end their own sessions; admins can end any
      if (role === 'AGENT' && session.agent_id !== agentId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      // Update session status and end time
      await stopRecording(id, true);

      await query(
        `UPDATE sessions
         SET status = 'ENDED', end_time = NOW()
         WHERE id = $1`,
        [id],
      );

      // Mark any participants still in the session as left
      await query(
        `UPDATE participants SET left_at = NOW()
         WHERE session_id = $1 AND left_at IS NULL`,
        [id],
      );

      // Broadcast room:closed to all sockets in this room via Socket.io
      // Imported lazily to avoid circular dependency at startup
      try {
        const { io } = await import('../socket');
        if (io) {
          io.to(id).emit('room:closed');
          // Disconnect all sockets in the room
          const sockets = await io.in(id).fetchSockets();
          sockets.forEach((s) => s.disconnect(true));
        }
      } catch {
        // Socket.io not yet initialised — session ended via REST without active call
      }

      res.json({ message: 'Session ended', sessionId: id });
    } catch (err) {
      console.error('[Sessions] End error:', (err as Error).message);
      res.status(500).json({ error: 'Failed to end session' });
    }
  },
);

export default router;
