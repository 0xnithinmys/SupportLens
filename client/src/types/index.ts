// ── Auth ──────────────────────────────────────────────────────────────────────
export type UserRole = 'AGENT' | 'ADMIN';
export type ParticipantRole = 'AGENT' | 'CUSTOMER';

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: UserRole;
  };
}

// ── Session ─────────────────────────────────────────────────────────────────
export type SessionStatus = 'WAITING' | 'ACTIVE' | 'ENDED';

export interface Session {
  id: string;
  agent_id: string;
  status: SessionStatus;
  start_time: string | null;
  end_time: string | null;
  recording_url: string | null;
  created_at?: string;
  agent_email?: string;
  participants?: ParticipantWithDuration[];
}

export interface CreatedSession {
  id: string;
  agentId: string;
  status: SessionStatus;
}

export interface CreateSessionResponse {
  session: CreatedSession;
  inviteUrl: string;
}

// ── Participant ──────────────────────────────────────────────────────────────
export interface Participant {
  id: string;
  session_id: string;
  display_name: string;
  role: ParticipantRole;
  joined_at: string;
  left_at: string | null;
}

export interface ParticipantWithDuration extends Participant {
  duration_seconds?: number;
}

export interface SessionHistoryResponse {
  data: Session[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ── Chat ─────────────────────────────────────────────────────────────────────
export interface ChatMessage {
  id: string;
  session_id: string;
  sender_name: string;
  payload: string;
  is_file: boolean;
  timestamp: string;
}

// ── Media / Telemetry ────────────────────────────────────────────────────────
export interface MediaStats {
  rtt: number;
  jitter: number;
  packetLossFraction: number;
  timestamp: number;
}
