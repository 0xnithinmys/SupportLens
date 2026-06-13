/**
 * migrate.ts
 * -----------
 * Reads all *.sql files from the migrations/ directory in alphabetical order,
 * checks schema_migrations to skip already-applied files, and runs new ones
 * inside a transaction so a partial failure leaves the DB in a clean state.
 *
 * Usage:
 *   npx ts-node src/db/migrate.ts
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pool } from '../config/db';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate(): Promise<void> {
  const client = await pool.connect();

  try {
    // ── 1. Bootstrap the tracker table (idempotent) ──────────────────────
    const trackerSql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '000_migrations_tracker.sql'),
      'utf8',
    );
    await client.query(trackerSql);
    console.log('[Migrate] Tracker table ready.');

    // ── 2. Collect all migration files (sorted) ──────────────────────────
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && f !== '000_migrations_tracker.sql')
      .sort();

    for (const file of files) {
      // ── 3. Check if already applied ────────────────────────────────────
      const { rows } = await client.query<{ filename: string }>(
        'SELECT filename FROM schema_migrations WHERE filename = $1',
        [file],
      );

      if (rows.length > 0) {
        console.log(`[Migrate] Skipping (already applied): ${file}`);
        continue;
      }

      // ── 4. Run inside a transaction ────────────────────────────────────
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
        console.log(`[Migrate] Applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration failed for ${file}: ${(err as Error).message}`);
      }
    }

    console.log('[Migrate] All migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err: Error) => {
  console.error('[Migrate] Fatal error:', err.message);
  process.exit(1);
});
