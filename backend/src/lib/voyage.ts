// voyage.ts — Voyage AI embedding client for dispatch-seven
// Model: voyage-3-lite (1024 dims, $0.02/1M tokens)
// Key loaded from env at call-time — never hardcoded.
// Ref: https://docs.voyageai.com/reference/embeddings-api

const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3-lite"; // 1024-dimensional

function getKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY env var not set");
  return key;
}

/**
 * Embed a single text string.
 * Throws on API error — callers should catch and degrade gracefully.
 */
export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(VOYAGE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: VOYAGE_MODEL, input: [text] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Voyage API error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

/**
 * Embed a batch of texts.
 * Voyage allows up to 128 inputs per call — this chunks automatically.
 * Returns embeddings in the same order as the input array.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const CHUNK_SIZE = 128;
  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
    chunks.push(texts.slice(i, i + CHUNK_SIZE));
  }

  const results: number[][] = [];
  for (const chunk of chunks) {
    const res = await fetch(VOYAGE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: chunk }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Voyage batch API error ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    // Voyage returns results in order — preserve that
    results.push(...data.data.map((d) => d.embedding));
  }
  return results;
}
