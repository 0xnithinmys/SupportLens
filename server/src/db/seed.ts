/**
 * seed.ts
 * --------
 * Inserts development/testing data into the database.
 * Safe to run multiple times — uses ON CONFLICT DO NOTHING.
 *
 * Default credentials (Argon2 hashed):
 *   admin@atomquest.dev  →  Admin@123
 *   agent@atomquest.dev  →  Agent@123
 *
 * Usage:
 *   npx ts-node src/db/seed.ts
 */

import 'dotenv/config';
import argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/db';

async function seed(): Promise<void> {
  const client = await pool.connect();

  try {
    console.log('[Seed] Hashing passwords…');

    const adminHash = await argon2.hash('Admin@123');
    const agentHash = await argon2.hash('Agent@123');

    const adminId = uuidv4();
    const agentId = uuidv4();

    // ── Users ────────────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO users (id, email, password_hash, role)
       VALUES
         ($1, 'admin@atomquest.dev', $2, 'ADMIN'),
         ($3, 'agent@atomquest.dev', $4, 'AGENT')
       ON CONFLICT (email) DO NOTHING`,
      [adminId, adminHash, agentId, agentHash],
    );
    console.log('[Seed] Users seeded (admin + agent).');

    // ── Sample session ────────────────────────────────────────────────────
    // Re-query to get the actual agent id (might already exist from a previous run)
    const { rows: agentRows } = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'agent@atomquest.dev'`,
    );
    const actualAgentId = agentRows[0]?.id;

    if (actualAgentId) {
      const sessionId = uuidv4();

      await client.query(
        `INSERT INTO sessions (id, agent_id, status)
         VALUES ($1, $2, 'WAITING')
         ON CONFLICT DO NOTHING`,
        [sessionId, actualAgentId],
      );

      // ── Sample participants ─────────────────────────────────────────────
      await client.query(
        `INSERT INTO participants (session_id, display_name, role)
         VALUES
           ($1, 'Support Agent', 'AGENT'),
           ($1, 'John Customer', 'CUSTOMER')
         ON CONFLICT DO NOTHING`,
        [sessionId],
      );

      // ── Sample chat messages ────────────────────────────────────────────
      await client.query(
        `INSERT INTO chat_messages (session_id, sender_name, payload, is_file)
         VALUES
           ($1, 'Support Agent',  'Hello! How can I help you today?', false),
           ($1, 'John Customer',  'My device is not turning on.',      false),
           ($1, 'Support Agent',  'Can you share a photo of the device?', false),
           ($1, 'John Customer',  'https://storage.atomquest.dev/samples/device.jpg', true)
         ON CONFLICT DO NOTHING`,
        [sessionId],
      );

      console.log('[Seed] Sample session, participants, and chat messages seeded.');
    }

    console.log('[Seed] Done.');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err: Error) => {
  console.error('[Seed] Fatal error:', err.message);
  process.exit(1);
});
