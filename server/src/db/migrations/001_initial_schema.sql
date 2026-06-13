-- Migration: 001_initial_schema.sql
-- Creates the full schema for the AtomQuest Video Support Platform

-- ── Enable UUID extension ──────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── users ──────────────────────────────────────────────────────────────────
-- Stores authenticated Agents and Admins only.
-- Customers are transient and tracked in the participants table.
CREATE TABLE IF NOT EXISTS users (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role         VARCHAR(10)  NOT NULL CHECK (role IN ('AGENT', 'ADMIN')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ── sessions ───────────────────────────────────────────────────────────────
-- Each support session has a UUID that doubles as the secure invite token.
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        VARCHAR(10)  NOT NULL DEFAULT 'WAITING'
                              CHECK (status IN ('WAITING', 'ACTIVE', 'ENDED')),
  start_time    TIMESTAMPTZ,
  end_time      TIMESTAMPTZ,
  recording_url VARCHAR(512),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions (agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status   ON sessions (status);

-- ── participants ───────────────────────────────────────────────────────────
-- Tracks every person (agent or customer) inside a session with entry/exit times.
CREATE TABLE IF NOT EXISTS participants (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  display_name VARCHAR(100) NOT NULL,
  role         VARCHAR(10)  NOT NULL CHECK (role IN ('AGENT', 'CUSTOMER')),
  joined_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  left_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_participants_session_id ON participants (session_id);

-- ── chat_messages ──────────────────────────────────────────────────────────
-- Persists every chat message and file reference from every session.
CREATE TABLE IF NOT EXISTS chat_messages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sender_name  VARCHAR(100) NOT NULL,
  payload      TEXT        NOT NULL,
  is_file      BOOLEAN     NOT NULL DEFAULT FALSE,
  timestamp    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages (session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp  ON chat_messages (timestamp);
