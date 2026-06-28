// Mem0 cloud memory client — cross-session context for Claude
// userId = session_id until auth is wired; swap to real user_id after.
// All functions: fire-and-forget safe. Mem0 down = silent pass-through.
//
// Voyage AI embeddings (voyage-3-lite, 1024-dim) are generated for every
// assistant turn and stored to dispatch7.memory so pgvector similarity
// search can work independently of Mem0 availability.

import MemoryClient from "mem0ai";
import { supabase } from "./supabase.js";
import { embedText } from "./voyage.js";

const TIMEOUT_MS = 2000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("mem0 timeout")), TIMEOUT_MS)
    ),
  ]);
}

function getClient(): MemoryClient | null {
  const key = process.env.MEM0_API_KEY;
  if (!key) return null;
  return new MemoryClient({ api_key: key });
}

export async function addMemory(
  userId: string,
  messages: { role: string; content: string }[],
  agentId = "dispatch7"
): Promise<void> {
  // Fire-and-forget: Mem0 store
  withTimeout(
    (async () => {
      const client = getClient();
      if (!client) return;
      await client.add(messages, { user_id: userId, agent_id: agentId });
    })()
  ).catch(() => {/* Mem0 down — silent */});

  // Sync assistant turn to Supabase dispatch7.memory with Voyage embedding.
  // Embedding is generated async and degraded gracefully if Voyage is unavailable.
  const assistantMsg = messages.find((m) => m.role === "assistant");
  if (assistantMsg) {
    const snippet = assistantMsg.content.slice(0, 500);

    // Generate Voyage embedding — silently skip if key missing or API down
    let embedding: number[] | null = null;
    try {
      embedding = await embedText(snippet);
    } catch {
      // VOYAGE_API_KEY not set or API unreachable — store row without vector
    }

    supabase
      .schema("dispatch7")
      .from("memory")
      .insert({
        session_id: userId,
        content: snippet,
        ...(embedding ? { embedding } : {}),
        metadata: { role: "assistant", via: "mem0", model: "voyage-3-lite" },
      })
      .then(() => {/* ignore */})
      .catch(() => {/* Supabase down — silent */});
  }
}

export async function searchMemory(
  userId: string,
  query: string,
  limit = 5
): Promise<string[]> {
  try {
    const client = getClient();
    if (!client) return [];
    const results = await withTimeout(
      client.search(query, { user_id: userId, limit })
    );
    // mem0ai returns array of {memory: string, ...}
    return (results as Array<{ memory: string }>)
      .map((r) => r.memory)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function getRelevantContext(
  userId: string,
  query: string
): Promise<string> {
  const memories = await searchMemory(userId, query);
  if (!memories.length) return "";
  return "RELEVANT MEMORIES:\n" + memories.map((m) => `- ${m}`).join("\n");
}
