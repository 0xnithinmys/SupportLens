// ── User / Auth ──────────────────────────────────────────────────────────────
export type UserRole = 'AGENT' | 'ADMIN';
export type ParticipantRole = 'AGENT' | 'CUSTOMER';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  created_at: Date;
}

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

// ── Session ─────────────────────────────────────────────────────────────────
export type SessionStatus = 'WAITING' | 'ACTIVE' | 'ENDED';

export interface Session {
  id: string;
  agent_id: string;
  status: SessionStatus;
  start_time: Date | null;
  end_time: Date | null;
  recording_url: string | null;
}

// ── Participant ──────────────────────────────────────────────────────────────
export interface Participant {
  id: string;
  session_id: string;
  display_name: string;
  role: ParticipantRole;
  joined_at: Date;
  left_at: Date | null;
}

// ── Chat ─────────────────────────────────────────────────────────────────────
export interface ChatMessage {
  id: string;
  session_id: string;
  sender_name: string;
  payload: string;
  is_file: boolean;
  timestamp: Date;
}

// ── Socket.io custom socket data ─────────────────────────────────────────────
export type SocketRole = ParticipantRole | 'ADMIN';

export interface SocketData {
  userId: string;
  displayName: string;
  role: SocketRole;
  sessionId: string;
  transports: Set<string>;
}
