/**
 * auth.routes.ts
 * ---------------
 * POST /api/auth/login   → verify credentials, return JWT
 * GET  /api/auth/me      → return decoded JWT payload (protected)
 */

import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import { query } from '../config/db';
import { requireAuth, signToken } from '../middleware/auth.middleware';
import type { User } from '../types';

const router = Router();

// ── POST /api/auth/login ─────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  try {
    // Lookup user by email
    const result = await query<User>(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1',
      [email.toLowerCase().trim()],
    );

    const user = result.rows[0];

    if (!user) {
      // Use the same response as wrong password to prevent user enumeration
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Verify Argon2 hash
    const valid = await argon2.verify(user.password_hash, password);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Issue JWT
    const token = signToken({ sub: user.id, email: user.email, role: user.role });

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error('[Auth] Login error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────
router.get('/me', requireAuth, (_req: Request, res: Response): void => {
  res.json({ user: res.locals.user });
});

export default router;
