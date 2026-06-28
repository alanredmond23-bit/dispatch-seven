-- Migration 005: dispatch7.evidence table
-- Legal infrastructure: United States v. Redmond, 5:24-cr-00376 (E.D. Pa.)
-- Purpose: Store Five9 call recording transcripts as pgvector chunks for semantic search
-- Applied: 2026-06-28
-- Requires: pgvector extension (enabled on fifybuzwfaegloijrmqb)

-- Ensure pgvector extension is enabled (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Evidence table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dispatch7.evidence (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      text        NOT NULL DEFAULT '5:24-cr-00376',
  source_file  text        NOT NULL,
  chunk_index  integer     NOT NULL,
  content      text        NOT NULL,
  embedding    vector(1024),            -- Voyage AI voyage-3 (1024 dims)
  metadata     jsonb       DEFAULT '{}',
  created_at   timestamptz DEFAULT now()
);

-- ─── Indexes ────────────────────────────────────────────────────────────────────

-- IVFFlat index for approximate nearest-neighbor cosine search
-- lists=100 is appropriate for tables up to ~1M rows; increase for larger sets
CREATE INDEX IF NOT EXISTS evidence_embedding_ivfflat_idx
  ON dispatch7.evidence
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS evidence_case_id_idx
  ON dispatch7.evidence (case_id);

CREATE INDEX IF NOT EXISTS evidence_source_file_idx
  ON dispatch7.evidence (source_file);

-- ─── Row-Level Security ─────────────────────────────────────────────────────────

ALTER TABLE dispatch7.evidence ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write — ACA backend uses SUPABASE_SERVICE_ROLE_KEY
CREATE POLICY "service_role_all"
  ON dispatch7.evidence
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── Semantic search function ────────────────────────────────────────────────────
-- Returns ranked chunks by cosine similarity to query_embedding.
-- Called by POST /api/evidence/search via supabase.rpc("match_evidence", ...)

CREATE OR REPLACE FUNCTION dispatch7.match_evidence(
  query_embedding  vector(1024),
  match_case_id    text    DEFAULT '5:24-cr-00376',
  match_count      integer DEFAULT 10
)
RETURNS TABLE (
  id               uuid,
  case_id          text,
  source_file      text,
  chunk_index      integer,
  content          text,
  metadata         jsonb,
  created_at       timestamptz,
  similarity       float
)
LANGUAGE plpgsql
SECURITY DEFINER  -- runs as owner (service_role); bypasses RLS for internal use
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.case_id,
    e.source_file,
    e.chunk_index,
    e.content,
    e.metadata,
    e.created_at,
    -- cosine similarity: 1 - cosine_distance
    (1 - (e.embedding <=> query_embedding))::float AS similarity
  FROM dispatch7.evidence e
  WHERE e.case_id = match_case_id
    AND e.embedding IS NOT NULL
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
