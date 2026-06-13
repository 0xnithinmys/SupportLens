-- Migration: 002_migrations_tracker.sql
-- Creates a table to track which migrations have been applied,
-- preventing duplicate runs.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          SERIAL      PRIMARY KEY,
  filename    VARCHAR(255) NOT NULL UNIQUE,
  applied_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
