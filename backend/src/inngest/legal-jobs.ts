// Inngest job functions for Turn 7 legal pipeline
// Registered as scheduled + on-demand triggers for Five9 indexing and Voyage backfill
// [DRAFT — attorney review required before any court use]
//
// Five9IndexJob  — nightly at 2am, indexes WAV blobs from Azure → legal_evidence
// VoyageBackfillJob — nightly at 3am + on-demand, embeds legal_documents via Voyage AI

import { inngest } from "../lib/inngest.js";

// ── 1. five9IndexJob ──────────────────────────────────────────────────────────
// Runs nightly at 02:00 — pulls Five9 WAV blobs from Azure Blob Storage
// and upserts records into dispatch_ops.legal_evidence.
// Env vars required:
//   AZURE_STORAGE_CONNECTION_STRING — connection string for legal2026 storage account
//   SUPABASE_URL                    — project URL
//   SUPABASE_SERVICE_KEY            — service-role key (bypasses RLS)
export const five9IndexJob = inngest.createFunction(
  { id: "five9-index", name: "Five9 Evidence Indexer" },
  { cron: "0 2 * * *" },
  async ({ step, logger }) => {
    const result = await step.run("index-blobs", async () => {
      // Dynamic import keeps the cold-start bundle small
      const { indexFive9Evidence } = await import("../agents/five9-indexer.js");
      return indexFive9Evidence(
        process.env.AZURE_STORAGE_CONNECTION_STRING!,
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY!
      );
    });

    logger.info(
      `[five9IndexJob] complete — indexed: ${result.indexed}, errors: ${result.errors}`
    );
    return result;
  }
);

// ── 2. voyageBackfillJob ──────────────────────────────────────────────────────
// Runs nightly at 03:00 AND on-demand via "legal/backfill.requested" event.
// Finds legal_documents rows where embedding IS NULL and backfills using
// Voyage AI voyage-law-2 (1024 dims) via SUPABASE pgvector column.
// Env vars required:
//   VOYAGE_API_KEY       — Voyage AI API key
//   SUPABASE_URL         — project URL
//   SUPABASE_SERVICE_KEY — service-role key (bypasses RLS)
export const voyageBackfillJob = inngest.createFunction(
  { id: "voyage-backfill", name: "Voyage AI Legal RAG Backfill" },
  [
    { cron: "0 3 * * *" },
    { event: "legal/backfill.requested" },
  ],
  async ({ step, logger }) => {
    const result = await step.run("embed-documents", async () => {
      const { backfillLegalEmbeddings } = await import(
        "../lib/voyage-legal-backfill.js"
      );
      return backfillLegalEmbeddings(
        process.env.VOYAGE_API_KEY!,
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY!
      );
    });

    logger.info(
      `[voyageBackfillJob] complete — embedded: ${result.embedded}, errors: ${result.errors}`
    );
    return result;
  }
);
