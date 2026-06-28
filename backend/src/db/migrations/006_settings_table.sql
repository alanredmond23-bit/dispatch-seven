-- Migration 006: dispatch7.settings key-value store
-- Applied: feature/settings-backend
-- Purpose: Persistent settings for D7 agents, models, budget caps, and system prompt overrides

CREATE TABLE IF NOT EXISTS dispatch7.settings (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Trigger: auto-update updated_at on row change
CREATE OR REPLACE FUNCTION dispatch7.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settings_updated_at ON dispatch7.settings;
CREATE TRIGGER settings_updated_at
  BEFORE UPDATE ON dispatch7.settings
  FOR EACH ROW EXECUTE FUNCTION dispatch7.set_updated_at();

-- RLS: only service_role can read/write (backend uses service role key)
ALTER TABLE dispatch7.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON dispatch7.settings;
CREATE POLICY "service_role_all"
  ON dispatch7.settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
