// backend/src/agents/index.ts — Legal Pipeline Agent Registry
// Turn 6: Five9 indexer, Franks builder, Voyage AI RAG backfill
//
// These are specialized sub-agents called by the LEGAL domain agent.
// They are NOT AgentDomain entries — they operate as library functions
// invoked by legal.ts or directly via API routes.
//
// Integration: import from here; pass secrets from env (Key Vault refs):
//   AZURE_STORAGE_CONNECTION_STRING → legal2026 storage account
//   SUPABASE_URL + SUPABASE_SERVICE_KEY → dispatch_ops schema
//   VOYAGE_API_KEY → voyage-law-2 embeddings
//
// [DRAFT ONLY — ATTORNEY REVIEW REQUIRED FOR ALL LEGAL OUTPUT]

export {
  indexFive9Evidence,
  type Five9Call,
  type IndexResult,
} from "./five9-indexer.js";

export {
  buildFranksMotion,
  type FranksChallenge,
  type FalsehoodType,
  type FranksMotionOutput,
} from "./franks-motion-builder.js";

export {
  backfillLegalEmbeddings,
  type LegalDocument,
  type DocumentType,
  type BackfillResult,
} from "../lib/voyage-legal-backfill.js";

// ── DAG node type registration ─────────────────────────────────────────────
// Sub-agent task types for use in TaskNode.type when dispatched from the
// DAG executor. Map these to handler invocations in inngest functions.

export const LEGAL_SUBTASK_TYPES = {
  FIVE9_INDEX:    "five9_index",    // Index Five9 WAV blobs → legal_evidence
  FRANKS_BUILD:   "franks_build",   // Build Franks challenge framework
  VOYAGE_BACKFILL: "voyage_backfill", // Embed legal_documents → pgvector
} as const;

export type LegalSubtaskType =
  (typeof LEGAL_SUBTASK_TYPES)[keyof typeof LEGAL_SUBTASK_TYPES];
