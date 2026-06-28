-- Migration T11: add due_date column to dispatch7.tasks
-- Enables SCHEDULER agent to persist deadline timestamps
-- Run against: project fifybuzwfaegloijrmqb (dispatch7 schema)

ALTER TABLE dispatch7.tasks
  ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_agent TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Index for upcoming-tasks query (sorted due_date for SCHEDULER agent)
CREATE INDEX IF NOT EXISTS idx_tasks_due_date
  ON dispatch7.tasks (due_date ASC)
  WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_agent
  ON dispatch7.tasks (assigned_agent)
  WHERE assigned_agent IS NOT NULL;

-- Same migration for the test schema used by integration tests
CREATE SCHEMA IF NOT EXISTS dispatch7_test;

CREATE TABLE IF NOT EXISTS dispatch7_test.tasks (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',
  domain         TEXT NOT NULL DEFAULT 'PERSONAL',
  priority       TEXT NOT NULL DEFAULT 'p1',
  due_date       TIMESTAMPTZ,
  assigned_agent TEXT,
  metadata       JSONB DEFAULT '{}',
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispatch7_test.agent_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   TEXT,
  agent        TEXT NOT NULL,
  model        TEXT,
  tokens_in    INT DEFAULT 0,
  tokens_out   INT DEFAULT 0,
  cost_usd     NUMERIC(10,6) DEFAULT 0,
  tool_calls   INT DEFAULT 0,
  status       TEXT DEFAULT 'running',
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dispatch7_test.tasks_graph (
  task_id    TEXT,
  depends_on TEXT
);
