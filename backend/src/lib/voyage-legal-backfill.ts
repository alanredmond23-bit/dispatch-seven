// voyage-legal-backfill.ts — Voyage AI Legal Document Embedder
// Purpose: Batch-embed all legal discovery documents from Supabase using
//          Voyage AI voyage-law-2 model, storing 1024-dim vectors in
//          dispatch_ops.legal_documents for pgvector similarity search.
//
// Model: voyage-law-2 — optimized for legal text retrieval
//   Ref: https://docs.voyageai.com/docs/embeddings
//   Dims: 1024 (matches vector(1024) column in migration)
//
// Use: Trial prep semantic search — find relevant exhibits, motions,
//      transcripts by meaning rather than keyword matching.
//
// Case: United States v. Redmond, 5:24-cr-00376 (E.D. Pa., Schmehl, J.)
// [DRAFT ONLY — ATTORNEY REVIEW REQUIRED]

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-law-2"; // legal-optimized; 1024 dims

export type DocumentType =
  | "motion"
  | "exhibit"
  | "transcript"
  | "correspondence"
  | "evidence"
  | "docket";

export interface LegalDocument {
  id: string;
  content: string;
  source: string;
  document_type: DocumentType;
  case_number: string;
}

export interface BackfillResult {
  embedded: number;
  errors: number;
}

/**
 * Call Voyage AI to embed a batch of texts using voyage-law-2.
 * Returns embeddings in same order as input array.
 * Throws on non-2xx response so caller can catch and count errors.
 */
async function embedBatch(
  voyageApiKey: string,
  texts: string[]
): Promise<number[][]> {
  const res = await fetch(VOYAGE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${voyageApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: "document", // 'document' for indexing; use 'query' at search time
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Voyage API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  // Sort by index to guarantee order matches input array
  const sorted = data.data.sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

/**
 * Write embeddings back to Supabase for a batch of docs.
 */
async function storeEmbeddings(
  supabase: SupabaseClient,
  docs: LegalDocument[],
  embeddings: number[][]
): Promise<{ stored: number; errors: number }> {
  let stored = 0;
  let errors = 0;

  for (let i = 0; i < docs.length; i++) {
    const { error } = await supabase
      .from("legal_documents")
      .update({
        embedding: embeddings[i],
        updated_at: new Date().toISOString(),
      })
      .eq("id", docs[i].id);

    if (error) {
      console.error(
        `[voyage-backfill] update error for doc ${docs[i].id}:`,
        error.message
      );
      errors++;
    } else {
      stored++;
    }
  }

  return { stored, errors };
}

/**
 * Backfill embeddings for all legal_documents rows where embedding IS NULL.
 * Processes up to 1000 docs per run; run again to continue backfill.
 * Safe to run multiple times — only touches unembedded rows.
 *
 * @param voyageApiKey  Voyage AI API key (from Key Vault menagerie-kv-37040)
 * @param supabaseUrl   Supabase project URL
 * @param supabaseKey   Supabase service role key (from Key Vault)
 * @param batchSize     Texts per Voyage API call (max 128; default 50)
 * @returns             Total embedded and error counts
 */
export async function backfillLegalEmbeddings(
  voyageApiKey: string,
  supabaseUrl: string,
  supabaseKey: string,
  batchSize: number = 50
): Promise<BackfillResult> {
  // Clamp batch size — Voyage max is 128 inputs per call
  const safeBatch = Math.min(batchSize, 128);

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch unembedded docs (limit 1000 per run to stay within memory/time budget)
  const { data: docs, error: fetchError } = await supabase
    .from("legal_documents")
    .select("id, content, source, document_type, case_number")
    .is("embedding", null)
    .limit(1000);

  if (fetchError || !docs) {
    console.error("[voyage-backfill] fetch error:", fetchError?.message ?? "no data");
    return { embedded: 0, errors: 1 };
  }

  console.log(`[voyage-backfill] ${docs.length} unembedded docs found`);

  let totalEmbedded = 0;
  let totalErrors = 0;

  for (let i = 0; i < docs.length; i += safeBatch) {
    const batch = docs.slice(i, i + safeBatch) as LegalDocument[];
    const batchLabel = `batch ${Math.floor(i / safeBatch) + 1}/${Math.ceil(docs.length / safeBatch)}`;

    try {
      console.log(`[voyage-backfill] embedding ${batchLabel} (${batch.length} docs)`);
      const embeddings = await embedBatch(voyageApiKey, batch.map((d) => d.content));

      const { stored, errors } = await storeEmbeddings(supabase, batch, embeddings);
      totalEmbedded += stored;
      totalErrors += errors;

      console.log(`[voyage-backfill] ${batchLabel} done — stored: ${stored}, errors: ${errors}`);
    } catch (e) {
      totalErrors += batch.length;
      console.error(`[voyage-backfill] ${batchLabel} failed:`, e);
    }
  }

  console.log(
    `[voyage-backfill] complete — embedded: ${totalEmbedded}, errors: ${totalErrors}`
  );
  return { embedded: totalEmbedded, errors: totalErrors };
}
