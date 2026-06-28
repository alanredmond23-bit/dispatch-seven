-- Migration: 20260627_legal_pipeline.sql
-- Turn 6 — Legal pipeline tables
-- Cases: 5:24-cr-00376 (criminal) | 4:24-bk-13093 (bankruptcy)
-- [DRAFT ONLY — ATTORNEY REVIEW REQUIRED]
--
-- Tables:
--   dispatch_ops.legal_evidence    — Five9 call recording index
--   dispatch_ops.legal_documents   — Discovery docs with Voyage AI embeddings
--   dispatch_ops.franks_challenges — Franks v. Delaware challenge arguments
--
-- Requires: pgvector extension enabled on Supabase project
--           dispatch_ops schema must exist (see init-supabase.sql)

-- ─── Five9 call recording index ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_ops.legal_evidence (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  blob_name       TEXT        UNIQUE NOT NULL,  -- Azure blob path; unique constraint for upsert
  call_date       TIMESTAMPTZ,                  -- Parsed from Five9 filename (YYYYMMDD_HHMMSS)
  duration_seconds INTEGER,                     -- Estimated from file size (WAV PCM 8kHz mono)
  from_number     TEXT,                         -- Caller number extracted from filename
  to_number       TEXT,                         -- Called number extracted from filename
  agent_id        TEXT,                         -- Five9 agent identifier from filename
  file_size       BIGINT,                       -- Raw byte count from Azure blob properties
  evidence_tag    TEXT        NOT NULL,         -- Always 'five9_call_recording' for this source
  indexed_at      TIMESTAMPTZ DEFAULT NOW(),    -- When this record was inserted/updated
  container       TEXT        NOT NULL,         -- Azure container: '5-9-working-copy-alan'
  storage_account TEXT        NOT NULL,         -- Azure storage account: 'legal2026'
  notes           TEXT,                         -- Attorney annotation field
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE dispatch_ops.legal_evidence IS
  'Five9 call recording index from legal2026 Azure blob storage. '
  '612 WAV files. Used to counter government fraud theory in 5:24-cr-00376.';

COMMENT ON COLUMN dispatch_ops.legal_evidence.duration_seconds IS
  'Rough estimate only — assumes 16-bit PCM mono 8kHz = 16000 bytes/sec. '
  'Verify against actual WAV header before use in court.';

-- ─── Legal documents with Voyage AI embeddings ───────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_ops.legal_documents (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  content       TEXT        NOT NULL,           -- Full document text for embedding
  source        TEXT        NOT NULL,           -- Origin: filename, URL, docket entry
  document_type TEXT        CHECK (document_type IN (
                              'motion', 'exhibit', 'transcript',
                              'correspondence', 'evidence', 'docket'
                            )),
  case_number   TEXT        NOT NULL,           -- e.g. '5:24-cr-00376' or '4:24-bk-13093'
  embedding     vector(1024),                  -- Voyage AI voyage-law-2 (1024 dims)
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE dispatch_ops.legal_documents IS
  'Legal discovery documents embedded with Voyage AI voyage-law-2 for '
  'semantic similarity search during trial preparation.';

COMMENT ON COLUMN dispatch_ops.legal_documents.embedding IS
  'voyage-law-2 embedding, 1024 dimensions. NULL until backfill runs. '
  'Use vector_cosine_ops for similarity queries.';

-- pgvector IVFFlat index — cosine similarity for legal doc retrieval
-- lists=100 is appropriate for O(hundreds) to O(low thousands) of documents
CREATE INDEX IF NOT EXISTS legal_docs_embedding_idx
  ON dispatch_ops.legal_documents
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─── Franks v. Delaware challenge arguments ──────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_ops.franks_challenges (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  affidavit_statement TEXT    NOT NULL,         -- What the warrant affidavit claimed
  actual_evidence     TEXT    NOT NULL,         -- What Five9/other evidence actually shows
  falsehood_type      TEXT    CHECK (falsehood_type IN ('deliberate', 'reckless')),
  materiality         TEXT    NOT NULL,         -- Why excising this destroys probable cause
  evidence_source     TEXT    NOT NULL,         -- Five9 recording ID or exhibit reference
  status              TEXT    DEFAULT 'draft',  -- draft | under_review | approved
  attorney_reviewed   BOOLEAN DEFAULT FALSE,    -- Must be TRUE before any court use
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE dispatch_ops.franks_challenges IS
  '[DRAFT ONLY — NOT FOR FILING] Franks v. Delaware, 438 U.S. 154 (1978) '
  'challenge arguments. All rows require attorney_reviewed = TRUE and '
  'licensed counsel sign-off before any court submission. '
  'Case: United States v. Redmond, 5:24-cr-00376.';

-- ─── Trigger: auto-update updated_at on legal_documents ──────────────────────
CREATE OR REPLACE FUNCTION dispatch_ops.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS legal_documents_updated_at ON dispatch_ops.legal_documents;
CREATE TRIGGER legal_documents_updated_at
  BEFORE UPDATE ON dispatch_ops.legal_documents
  FOR EACH ROW EXECUTE FUNCTION dispatch_ops.set_updated_at();
