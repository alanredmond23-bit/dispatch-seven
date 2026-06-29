-- Migration: 010_notification_storage.sql
-- dispatch7 schema: notifications, sessions, decisions tables
-- Applied to project: fifybuzwfaegloijrmqb

-- ── dispatch7.notifications ──────────────────────────────────────────────────
-- All system messages: txt files, popups, ntfy alerts.
-- Auto-read logic (mark read on next user message) is handled in the
-- application layer via markSessionRead() in lib/notify.ts — not a DB trigger.

CREATE TABLE IF NOT EXISTS dispatch7.notifications (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  source       TEXT        NOT NULL CHECK (source IN ('COWORK', 'DISPATCH', 'D7')),
  project      TEXT        NOT NULL DEFAULT 'D7',
  session_id   TEXT,
  type         TEXT        NOT NULL CHECK (type IN ('popup', 'txt', 'ntfy', 'alert')),
  category     TEXT        CHECK (category IN ('d7_status','legal','money','devops','merge','deploy','deadline')),
  title        TEXT        NOT NULL,
  body         TEXT        NOT NULL,
  priority     TEXT        CHECK (priority IN ('P0','P1','P2','info')) DEFAULT 'info',
  related_pr   INTEGER,
  related_case TEXT,
  read_at      TIMESTAMPTZ,
  metadata     JSONB       DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_notifications_created  ON dispatch7.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_category ON dispatch7.notifications(category, type);
CREATE INDEX IF NOT EXISTS idx_notifications_session  ON dispatch7.notifications(session_id, read_at);

ALTER TABLE dispatch7.notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'dispatch7'
      AND tablename  = 'notifications'
      AND policyname = 'service_role_only'
  ) THEN
    CREATE POLICY "service_role_only" ON dispatch7.notifications
      USING (auth.role() = 'service_role');
  END IF;
END $$;


-- ── dispatch7.sessions ────────────────────────────────────────────────────────
-- Full conversation archives from extractions.
-- full_transcript: unified [{role, content, timestamp}] conversation schema.
-- artifacts: [{name, type, path, sha256}]
-- decisions: [{trigger, rationale, outcome}] inline for small sessions;
--            large sessions fan out to dispatch7.decisions.

CREATE TABLE IF NOT EXISTS dispatch7.sessions (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  session_date    DATE        NOT NULL,
  source          TEXT        NOT NULL CHECK (source IN ('COWORK', 'DISPATCH', 'D7', 'CLAUDE_AI')),
  project         TEXT        NOT NULL DEFAULT 'D7',
  title           TEXT,
  summary         TEXT,          -- tier-4 executive summary of the session
  full_transcript JSONB,         -- unified conversation: [{role, content, timestamp}]
  artifacts       JSONB          DEFAULT '[]', -- [{name, type, path, sha256}]
  decisions       JSONB          DEFAULT '[]', -- [{trigger, rationale, outcome}]
  token_count     INTEGER,
  model           TEXT,
  metadata        JSONB          DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sessions_date   ON dispatch7.sessions(session_date DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_source ON dispatch7.sessions(source, project);

ALTER TABLE dispatch7.sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'dispatch7'
      AND tablename  = 'sessions'
      AND policyname = 'service_role_only'
  ) THEN
    CREATE POLICY "service_role_only" ON dispatch7.sessions
      USING (auth.role() = 'service_role');
  END IF;
END $$;


-- ── dispatch7.decisions ───────────────────────────────────────────────────────
-- Key decisions extracted from sessions (Layer 2 synthesis).
-- Foreign key to sessions is SET NULL on delete so decisions survive
-- session purges (audit trail preservation).

CREATE TABLE IF NOT EXISTS dispatch7.decisions (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  session_id   UUID        REFERENCES dispatch7.sessions(id) ON DELETE SET NULL,
  source       TEXT        NOT NULL CHECK (source IN ('COWORK', 'DISPATCH', 'D7')),
  project      TEXT        NOT NULL DEFAULT 'D7',
  trigger      TEXT        NOT NULL,   -- what caused the decision
  decision     TEXT        NOT NULL,   -- what was decided
  rationale    TEXT,                   -- why
  outcome      TEXT,                   -- what happened after
  category     TEXT        CHECK (category IN ('architecture','legal','money','devops','product','ops')),
  related_pr   INTEGER,
  related_case TEXT,
  tags         TEXT[],
  metadata     JSONB       DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_decisions_project ON dispatch7.decisions(project, category);
CREATE INDEX IF NOT EXISTS idx_decisions_session ON dispatch7.decisions(session_id);

ALTER TABLE dispatch7.decisions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'dispatch7'
      AND tablename  = 'decisions'
      AND policyname = 'service_role_only'
  ) THEN
    CREATE POLICY "service_role_only" ON dispatch7.decisions
      USING (auth.role() = 'service_role');
  END IF;
END $$;
