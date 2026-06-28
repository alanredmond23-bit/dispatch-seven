// five9-indexer.ts — Five9 WAV Evidence Indexer
// Purpose: Index Five9 call recordings from legal2026 blob storage,
//          extract call metadata from filenames, and upsert into
//          dispatch_ops.legal_evidence (Supabase) for trial prep search.
// Case: United States v. Redmond, 5:24-cr-00376 (E.D. Pa., Schmehl, J.)
// Defense theory: Five9 recordings prove legitimate business activity,
//                 contradicting the government's fraud theory.
// [DRAFT ONLY — ATTORNEY REVIEW REQUIRED]

import { createClient } from "@supabase/supabase-js";
import { BlobServiceClient } from "@azure/storage-blob";

// Container holding 612 blobs in legal2026 Azure storage account
const CONTAINER_NAME = "5-9-working-copy-alan";
const STORAGE_ACCOUNT = "legal2026";

export interface Five9Call {
  blobName: string;
  callDate: Date | null;
  durationSeconds: number | null;
  fromNumber: string | null;
  toNumber: string | null;
  agentId: string | null;
  fileSize: number;
  evidenceTag: string; // always 'five9_call_recording'
  indexedAt: Date;
}

export interface IndexResult {
  indexed: number;
  errors: number;
  summary: Five9Call[];
}

/**
 * Parse Five9 WAV filename into call metadata.
 * Expected pattern: YYYYMMDD_HHMMSS_fromNumber_toNumber_agentId.wav
 * Returns null fields for anything that does not parse — never throws.
 */
function parseFive9Filename(
  filename: string
): Pick<Five9Call, "callDate" | "fromNumber" | "toNumber" | "agentId"> {
  const base = filename.replace(/\.wav$/i, "");
  const parts = base.split("_");

  let callDate: Date | null = null;
  if (parts[0]?.length === 8 && parts[1]?.length === 6) {
    const iso =
      `${parts[0].slice(0, 4)}-${parts[0].slice(4, 6)}-${parts[0].slice(6, 8)}` +
      `T${parts[1].slice(0, 2)}:${parts[1].slice(2, 4)}:${parts[1].slice(4, 6)}`;
    const d = new Date(iso);
    callDate = isNaN(d.getTime()) ? null : d;
  }

  return {
    callDate,
    fromNumber: parts[2] ?? null,
    toNumber: parts[3] ?? null,
    agentId: parts[4] ?? null,
  };
}

/**
 * Rough WAV duration estimate from byte size.
 * Assumes 16-bit PCM mono 8kHz (telephony standard) = 16000 bytes/sec.
 * Actual encoding may differ; treat as an estimate only.
 */
function estimateDurationSeconds(contentLength: number | undefined): number | null {
  if (!contentLength) return null;
  return Math.floor(contentLength / 16000);
}

/**
 * Index all Five9 WAV recordings from legal2026 blob storage into Supabase.
 * Idempotent — uses UPSERT on blob_name unique constraint.
 *
 * @param connectionString  Azure storage connection string (from Key Vault menagerie-kv-37040)
 * @param supabaseUrl       Supabase project URL
 * @param supabaseKey       Supabase service role key (from Key Vault)
 * @returns                 Count of indexed files, error count, full summary
 */
export async function indexFive9Evidence(
  connectionString: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<IndexResult> {
  const blobClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobClient.getContainerClient(CONTAINER_NAME);
  const supabase = createClient(supabaseUrl, supabaseKey);

  const results: Five9Call[] = [];
  let errors = 0;
  const indexedAt = new Date();

  for await (const blob of containerClient.listBlobsFlat()) {
    // Only process WAV files — skip any stray extension
    if (!blob.name.toLowerCase().endsWith(".wav")) continue;

    try {
      const { callDate, fromNumber, toNumber, agentId } =
        parseFive9Filename(blob.name);

      const record: Five9Call = {
        blobName: blob.name,
        callDate,
        durationSeconds: estimateDurationSeconds(blob.properties.contentLength),
        fromNumber,
        toNumber,
        agentId,
        fileSize: blob.properties.contentLength ?? 0,
        evidenceTag: "five9_call_recording",
        indexedAt,
      };

      const { error } = await supabase.from("legal_evidence").upsert(
        {
          blob_name: record.blobName,
          call_date: record.callDate?.toISOString() ?? null,
          duration_seconds: record.durationSeconds,
          from_number: record.fromNumber,
          to_number: record.toNumber,
          agent_id: record.agentId,
          file_size: record.fileSize,
          evidence_tag: record.evidenceTag,
          indexed_at: record.indexedAt.toISOString(),
          container: CONTAINER_NAME,
          storage_account: STORAGE_ACCOUNT,
        },
        { onConflict: "blob_name" }
      );

      if (error) {
        console.error(
          `[five9-indexer] supabase error for ${blob.name}:`,
          error.message
        );
        errors++;
        continue;
      }

      results.push(record);
      console.log(`[five9-indexer] indexed: ${blob.name}`);
    } catch (e) {
      errors++;
      console.error(`[five9-indexer] error processing ${blob.name}:`, e);
    }
  }

  console.log(
    `[five9-indexer] complete — indexed: ${results.length}, errors: ${errors}`
  );
  return { indexed: results.length, errors, summary: results };
}
