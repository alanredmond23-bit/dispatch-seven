// evidence.ts — Hono routes for Five9 WAV evidence ingestion + semantic search
// Legal infrastructure: United States v. Redmond, 5:24-cr-00376 (E.D. Pa.)
//
// Routes:
//   POST /api/evidence/ingest  — multipart WAV upload → transcribe → chunk → embed → store
//   POST /api/evidence/search  — semantic vector search over evidence chunks
//   GET  /api/evidence/list    — list ingested files with chunk counts + metadata

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";
import { indexFive9Wav } from "../lib/five9-indexer.js";

export const evidenceRoutes = new Hono();

const DEFAULT_CASE_ID = "5:24-cr-00376";
const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3";

// ─── P0-2: Bearer-token auth middleware ───────────────────────────────────────
// All evidence routes require Authorization: Bearer <token>.
// Token is compared against API_BEARER_TOKEN env var.
// Evidence routes carry privileged legal material — must not be publicly accessible.
evidenceRoutes.use("*", async (c, next) => {
  const apiToken = process.env.API_BEARER_TOKEN;
  if (!apiToken) {
    // Misconfigured environment — deny all requests rather than fail open
    return c.json({ error: "Server misconfigured: API_BEARER_TOKEN not set" }, 503);
  }

  const authHeader = c.req.header("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!token || token !== apiToken) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return next();
});

// ─── Embed a query string ─────────────────────────────────────────────────────
// Separate from the document embedder in five9-indexer.ts.
// Uses input_type="query" — Voyage asymmetric retrieval: query ≠ document space.

async function embedQuery(text: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY env var not set");

  const res = await fetch(VOYAGE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [text],
      input_type: "query",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Voyage query embed error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

// ─── POST /ingest ─────────────────────────────────────────────────────────────

evidenceRoutes.post("/ingest", async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Multipart form data required" }, 400);
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return c.json({ error: "'file' field required (WAV audio)" }, 400);
  }

  const caseId =
    (formData.get("case_id") as string | null) ?? DEFAULT_CASE_ID;
  const callDate =
    (formData.get("call_date") as string | null) ??
    new Date().toISOString().split("T")[0];
  const filename = (file as File).name ?? "recording.wav";

  try {
    const arrayBuffer = await (file as File).arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await indexFive9Wav(buffer, filename, { caseId, callDate });

    return c.json({
      success: true,
      source_file: result.source_file,
      case_id: result.case_id,
      chunk_count: result.chunk_count,
      duration_seconds: result.duration_seconds,
      call_date: result.call_date,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[evidence/ingest]", message);
    return c.json({ error: message }, 500);
  }
});

// ─── POST /search ─────────────────────────────────────────────────────────────

evidenceRoutes.post("/search", async (c) => {
  let body: { query?: string; limit?: number; case_id?: string };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "JSON body required" }, 400);
  }

  const { query, limit = 10, case_id = DEFAULT_CASE_ID } = body;

  if (!query || typeof query !== "string" || query.trim() === "") {
    return c.json({ error: "'query' string required" }, 400);
  }

  const safeLimit = Math.min(Math.max(1, limit ?? 10), 50);

  try {
    const queryEmbedding = await embedQuery(query.trim());

    // Primary: call pgvector RPC (deployed with migration 005)
    const { data, error } = await supabase.rpc("match_evidence", {
      query_embedding: queryEmbedding,
      match_case_id: case_id,
      match_count: safeLimit,
    });

    if (error) {
      // Graceful fallback: return recent chunks if RPC not yet available
      // This lets the route function before the Supabase function is deployed
      console.warn("[evidence/search] match_evidence RPC unavailable, falling back:", error.message);

      const { data: fbData, error: fbError } = await supabase
        .from("evidence")
        .select("id, case_id, source_file, chunk_index, content, metadata, created_at")
        .eq("case_id", case_id)
        .order("created_at", { ascending: false })
        .limit(safeLimit);

      if (fbError) throw new Error(fbError.message);

      return c.json({
        results: fbData ?? [],
        query,
        case_id,
        note: "Vector search RPC not available — returning recent chunks. Re-apply migration 005 to enable semantic search.",
      });
    }

    return c.json({ results: data ?? [], query, case_id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[evidence/search]", message);
    return c.json({ error: message }, 500);
  }
});

// ─── GET /list ────────────────────────────────────────────────────────────────

evidenceRoutes.get("/list", async (c) => {
  const caseId = c.req.query("case_id") ?? DEFAULT_CASE_ID;

  try {
    const { data, error } = await supabase
      .from("evidence")
      .select("source_file, case_id, chunk_index, metadata, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    // Aggregate rows → per-file summary
    const files = new Map<
      string,
      {
        source_file: string;
        case_id: string;
        chunk_count: number;
        call_date: string | null;
        duration_seconds: number | null;
        ingested_at: string;
      }
    >();

    for (const row of data ?? []) {
      if (!files.has(row.source_file)) {
        const meta = row.metadata as Record<string, unknown> | null;
        files.set(row.source_file, {
          source_file: row.source_file,
          case_id: row.case_id,
          chunk_count: 0,
          call_date: (meta?.call_date as string) ?? null,
          duration_seconds: (meta?.duration_seconds as number) ?? null,
          ingested_at: row.created_at,
        });
      }
      files.get(row.source_file)!.chunk_count++;
    }

    return c.json({
      files: Array.from(files.values()),
      total_files: files.size,
      case_id: caseId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[evidence/list]", message);
    return c.json({ error: message }, 500);
  }
});
