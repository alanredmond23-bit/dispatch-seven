-- Migration 009: job_runs table + session materialized view helpers
-- Turn 9: tracks Inngest job state (queued → running → completed/failed)
-- Turn 10: sessions query support (derived from agent_runs)
-- Run with SUPABASE_SERVICE_ROLE

-- ── job_runs ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch7.job_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type    TEXT NOT NULL CHECK (job_type IN ('research', 'summary', 'deadline_sweep')),
  session_id  TEXT,
  payload     JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  result      JSONB,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_runs_session_idx ON dispatch7.job_runs (session_id);
CREATE INDEX IF NOT EXISTS job_runs_status_idx  ON dispatch7.job_runs (status);
CREATE INDEX IF NOT EXISTS job_runs_created_idx ON dispatch7.job_runs (created_at DESC);

ALTER TABLE dispatch7.job_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON dispatch7.job_runs;
CREATE POLICY "service_role_all" ON dispatch7.job_runs FOR ALL USING (auth.role() = 'service_role');

-- ── sessions view (derived from agent_runs) ───────────────────────────────────
CREATE OR REPLACE VIEW dispatch7.v_active_sessions AS
SELECT
  session_id,
  MAX(agent)       AS last_agent,
  ROUND(SUM(COALESCE(cost_usd, 0))::numeric, 4) AS total_cost_usd,
  COUNT(*)         AS run_count,
  MAX(started_at)  AS last_activity,
  CASE
    WHEN BOOL_OR(agent = 'LEGAL')    THEN 'legal'
    WHEN BOOL_OR(agent = 'RESEARCH') THEN 'research'
    WHEN BOOL_OR(agent = 'FINANCE')  THEN 'finance'
    WHEN BOOL_OR(agent = 'BUILD')    THEN 'engineering'
    ELSE 'general'
  END AS domain
FROM dispatch7.agent_runs
WHERE started_at >= NOW() - INTERVAL '24 hours'
  AND session_id IS NOT NULL
GROUP BY session_id;
