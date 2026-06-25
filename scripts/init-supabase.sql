-- D7 dispatch7 schema initialization
-- Project: fifybuzwfaegloijrmqb
-- Run as: SUPABASE_SERVICE_ROLE

CREATE SCHEMA IF NOT EXISTS dispatch7;

-- Agent registry
CREATE TABLE dispatch7.agents (
  name        TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'idle',
  last_ping   TIMESTAMPTZ,
  metadata    JSONB DEFAULT '{}'
);

INSERT INTO dispatch7.agents (name) VALUES
  ('ORCHESTRATOR'),('LEGAL'),('DISCOVERY'),('FINANCE'),
  ('BUILD'),('QA'),('RESEARCH'),('COMMS'),
  ('MEMORY'),('MONITOR'),('SCHEDULER'),('EXECUTE')
ON CONFLICT DO NOTHING;

-- Task queue
CREATE TABLE dispatch7.tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  body        TEXT,
  assignee    TEXT REFERENCES dispatch7.agents(name),
  priority    TEXT NOT NULL DEFAULT 'p1' CHECK (priority IN ('p0','p1','p2','p3')),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','blocked','done')),
  domain      TEXT NOT NULL DEFAULT 'DEVOPS',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Shared memory / cross-agent state
CREATE TABLE dispatch7.memory (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  agent       TEXT,
  expires_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Event audit log
CREATE TABLE dispatch7.events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent       TEXT NOT NULL,
  action      TEXT NOT NULL,
  payload     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Embeddings for D7 knowledge base (voyage-3 = 1024 dims)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE dispatch7.embeddings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content     TEXT NOT NULL,
  embedding   vector(1024),
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON dispatch7.embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Enable RLS
ALTER TABLE dispatch7.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch7.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch7.memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch7.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch7.embeddings ENABLE ROW LEVEL SECURITY;

-- Service role bypass
CREATE POLICY "service_role_all" ON dispatch7.agents FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON dispatch7.tasks FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON dispatch7.memory FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON dispatch7.events FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON dispatch7.embeddings FOR ALL USING (auth.role() = 'service_role');
