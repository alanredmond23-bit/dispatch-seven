-- 008_budget_overrides.sql
-- Persists budget override grants across process restarts.
-- session_id: the Dispatch7 session that received the override
-- granted_at: when the override was granted
-- expires_at: 24h TTL — row is logically expired after this timestamp

CREATE TABLE IF NOT EXISTS dispatch7.budget_overrides (
  session_id TEXT PRIMARY KEY,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

-- Index for fast expiry cleanup queries
CREATE INDEX IF NOT EXISTS idx_budget_overrides_expires_at
  ON dispatch7.budget_overrides (expires_at);
