// five9-indexer.ts — Five9 WAV call recording evidence indexer
// Legal infrastructure: United States v. Redmond, 5:24-cr-00376 (E.D. Pa.)
// Pipeline: WAV → Whisper transcription → ~500-token chunking → Voyage-3 embedding → Supabase pgvector
// Secrets: OPENAI_API_KEY, VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — never hardcoded

import { readFile } from "fs/promises";
import path from "path";
import { supabase } from "./supabase.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const WHISPER_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3"; // 1024-dimensional, per spec
const TARGET_CHUNK_TOKENS = 500;
const OVERLAP_TOKENS = 50;
// Conservative chars-per-token for English transcripts (~4 chars/token)
const CHARS_PER_TOKEN = 4;
const TARGET_CHUNK_CHARS = TARGET_CHUNK_TOKENS * CHARS_PER_TOKEN; // 2000
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN; // 200

const DEFAULT_CASE_ID = "5:24-cr-00376";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WhisperSegment {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
}

interface WhisperVerboseResponse {
  task: string;
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
}

export interface EvidenceChunk {
  chunk_index: number;
  content: string;
  timestamp_start: number;
  timestamp_end: number;
}

export interface IndexResult {
  source_file: string;
  case_id: string;
  chunk_count: number;
  duration_seconds: number;
  call_date: string;
  chunks: EvidenceChunk[];
}

export interface IndexOptions {
  caseId?: string;
  callDate?: string; // ISO date string; falls back to today
}

// ─── Step 1: Transcription ────────────────────────────────────────────────────
// Uses OpenAI Whisper whisper-1 with verbose_json to get segment-level timestamps.
// verbose_json gives us start/end per segment for accurate evidence timestamps.
// Fallback note: if OPENAI_API_KEY is absent, throw with clear message —
// Anthropic claude-3-5-haiku does not accept raw audio; audio must go through Whisper.

async function transcribeWav(
  audioBuffer: Buffer,
  filename: string
): Promise<WhisperVerboseResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY env var not set. " +
        "Whisper transcription requires an OpenAI key. " +
        "Add OPENAI_API_KEY to the ACA environment secrets."
    );
  }

  // Node 18+ has FormData + Blob globally — no extra deps required
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/wav" }); // cast: Blob constructor requires ArrayBufferView<ArrayBuffer>, not Buffer<ArrayBufferLike>
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  // Request segment-level timestamps for evidence traceability
  form.append("timestamp_granularities[]", "segment");

  const res = await fetch(WHISPER_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Whisper API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<WhisperVerboseResponse>;
}

// ─── Step 2: Chunking ─────────────────────────────────────────────────────────
// Groups Whisper segments into ~500-token chunks with 50-token overlap.
// Speaker-turn preservation: Whisper whisper-1 doesn't return speaker labels
// (that requires diarization — pyannote.audio or AWS Transcribe). Segments
// represent natural speech pauses which approximate turn boundaries. Labels
// can be overlaid post-hoc when diarization is added.

function chunkSegments(segments: WhisperSegment[]): EvidenceChunk[] {
  const chunks: EvidenceChunk[] = [];
  let chunkIndex = 0;
  let bufferTexts: string[] = [];
  let bufferStart = 0;
  let bufferEnd = 0;
  let bufferChars = 0;

  const flush = () => {
    if (bufferTexts.length === 0) return;
    chunks.push({
      chunk_index: chunkIndex++,
      content: bufferTexts.join(" ").trim(),
      timestamp_start: bufferStart,
      timestamp_end: bufferEnd,
    });
  };

  for (const seg of segments) {
    const segText = seg.text.trim();
    if (!segText) continue;

    if (bufferChars === 0) {
      bufferStart = seg.start;
    }

    bufferTexts.push(segText);
    bufferEnd = seg.end;
    bufferChars += segText.length;

    if (bufferChars >= TARGET_CHUNK_CHARS) {
      flush();
      // Carry the tail of the current chunk into the next for context overlap
      const fullText = bufferTexts.join(" ");
      const overlapText = fullText.slice(-OVERLAP_CHARS).trim();
      bufferTexts = overlapText ? [overlapText] : [];
      bufferChars = overlapText.length;
      bufferStart = bufferEnd; // overlap window starts at end of flushed chunk
    }
  }

  flush(); // final partial chunk
  return chunks;
}

// ─── Step 3: Embedding ────────────────────────────────────────────────────────
// Uses Voyage AI voyage-3 (1024 dims) with input_type="document" for stored evidence.
// Search queries use input_type="query" (asymmetric retrieval — handled in routes).

async function embedChunks(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY env var not set");

  const BATCH_SIZE = 128; // Voyage API max inputs per request
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const res = await fetch(VOYAGE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: batch,
        input_type: "document", // evidence storage mode
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Voyage API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    allEmbeddings.push(...data.data.map((d) => d.embedding));
  }

  return allEmbeddings;
}

// ─── Step 4: Storage ──────────────────────────────────────────────────────────
// Inserts all chunks + embeddings in a single batch to dispatch7.evidence.
// pgvector accepts JSON array notation for the vector column.

async function storeChunks(
  chunks: EvidenceChunk[],
  embeddings: number[][],
  sourceFile: string,
  caseId: string,
  callDate: string,
  durationSeconds: number
): Promise<void> {
  const rows = chunks.map((chunk, i) => ({
    case_id: caseId,
    source_file: sourceFile,
    chunk_index: chunk.chunk_index,
    content: chunk.content,
    embedding: JSON.stringify(embeddings[i]), // pgvector parses JSON array
    metadata: {
      timestamp_start: chunk.timestamp_start,
      timestamp_end: chunk.timestamp_end,
      duration_seconds: durationSeconds,
      call_date: callDate,
    },
  }));

  const { error } = await supabase.from("evidence").insert(rows);
  if (error) throw new Error(`Supabase insert error: ${error.message}`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Index a Five9 WAV call recording into the pgvector evidence table.
 *
 * @param input    - File path string OR raw WAV Buffer
 * @param filename - Original filename stored as source_file key
 * @param options  - Optional caseId / callDate overrides
 * @returns        IndexResult — chunk count, duration, call_date, per-chunk data
 */
export async function indexFive9Wav(
  input: string | Buffer,
  filename: string,
  options: IndexOptions = {}
): Promise<IndexResult> {
  const caseId = options.caseId ?? DEFAULT_CASE_ID;
  const callDate =
    options.callDate ?? new Date().toISOString().split("T")[0];

  // Resolve buffer from path or pass-through
  const audioBuffer: Buffer =
    typeof input === "string" ? await readFile(input) : input;

  const sourceFile =
    typeof input === "string" ? path.basename(input) : filename;

  // 1 → Transcribe
  const transcription = await transcribeWav(audioBuffer, sourceFile);
  const durationSeconds = transcription.duration ?? 0;

  // 2 → Chunk segments
  const chunks = chunkSegments(transcription.segments);
  if (chunks.length === 0) {
    throw new Error(`No transcript content extracted from ${sourceFile}`);
  }

  // 3 → Embed
  const embeddings = await embedChunks(chunks.map((c) => c.content));

  // 4 → Store
  await storeChunks(
    chunks,
    embeddings,
    sourceFile,
    caseId,
    callDate,
    durationSeconds
  );

  return {
    source_file: sourceFile,
    case_id: caseId,
    chunk_count: chunks.length,
    duration_seconds: durationSeconds,
    call_date: callDate,
    chunks,
  };
}
