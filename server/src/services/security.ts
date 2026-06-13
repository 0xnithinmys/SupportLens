import { query } from '../config/db';

export async function logSecurityEvent(
  eventType: string,
  message: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await query(
      `INSERT INTO security_events (event_type, message, metadata)
       VALUES ($1, $2, $3::jsonb)`,
      [eventType, message, JSON.stringify(metadata)],
    );
  } catch (err) {
    console.error('[Security] Failed to write audit event:', (err as Error).message);
  }
}
