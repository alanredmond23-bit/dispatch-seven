-- Migration 007: Legal pipeline RLS + SECURITY DEFINER search_path hardening
-- Applied: 2026-06-28
-- Refs: P0-7 (legal table RLS), P2-2 (SECURITY DEFINER missing search_path)

-- ─── P0-7: Enable RLS on legal pipeline tables (dispatch_ops schema) ──────────
-- Tables may not exist yet; IF EXISTS prevents failure on fresh deploys

ALTER TABLE IF EXISTS dispatch_ops.legal_evidence   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS dispatch_ops.legal_documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS dispatch_ops.franks_challenges ENABLE ROW LEVEL SECURITY;

-- Service-role-only policies — only the ACA backend (using SUPABASE_SERVICE_ROLE_KEY)
-- can read or write these tables. Anon / authenticated roles are blocked by default.
-- DROP IF EXISTS first so this migration is idempotent.

DROP POLICY IF EXISTS "service_role_only" ON dispatch_ops.legal_evidence;
DROP POLICY IF EXISTS "service_role_only" ON dispatch_ops.legal_documents;
DROP POLICY IF EXISTS "service_role_only" ON dispatch_ops.franks_challenges;

CREATE POLICY "service_role_only" ON dispatch_ops.legal_evidence
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_role_only" ON dispatch_ops.legal_documents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_role_only" ON dispatch_ops.franks_challenges
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── P2-2: Fix match_evidence SECURITY DEFINER missing search_path ───────────
-- Without SET search_path, a malicious user could create objects in a schema
-- that shadows dispatch7, leading to privilege escalation.
-- Function signature matches migration 005: (vector(1024), text, integer)

ALTER FUNCTION dispatch7.match_evidence(vector(1024), text, integer)
  SECURITY DEFINER
  SET search_path = dispatch7, pg_catalog;

-- Verify (informational — does not fail migration if pg_proc lookup is unavailable)
-- SELECT prosecdef, proconfig FROM pg_proc
--   WHERE proname = 'match_evidence'
--     AND pronamespace = 'dispatch7'::regnamespace;
