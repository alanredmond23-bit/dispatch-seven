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

// Mem0 SDK v3 Message type: role must be "user" | "assistant"
type Mem0Message = { role: "user" | "assistant"; content: string };

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
  return new MemoryClient({ apiKey: key });
}

export async function addMemory(
  userId: string,
  messages: Mem0Message[],
  agentId = "dispatch7"
): Promise<void> {
  // Runtime guard: messages must be a non-empty array
  if (!Array.isArray(messages)) {
    throw new Error('[mem0] addMemory: messages must be an array of {role, content} objects');
  }

  // Fire-and-forget: Mem0 store
  // SDK v3 options use camelCase: userId, agentId (not user_id, agent_id)
  (withTimeout(
    (async () => {
      const client = getClient();
      if (!client) return;
      await client.add(messages, { userId, agentId });
    })()
  ) as Promise<void>).catch(() => {/* Mem0 down — silent */});

  // Sync assistant turn to Supabase dispatch7.memory with Voyage embedding.
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

    void Promise.resolve(
      supabase
        .schema("dispatch7")
        .from("memory")
        .insert({
          session_id: userId,
          content: snippet,
          ...(embedding ? { embedding } : {}),
          metadata: { role: "assistant", via: "mem0", model: "voyage-3-lite" },
        })
    ).catch(() => {/* Supabase down — silent */});
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
    // SDK v3 search() returns { results: Memory[] } — Memory has optional .memory string
    const response = await withTimeout(
      client.search(query, { filters: { user_id: userId }, topK: limit })
    );
    return response.results
      .map((r) => r.memory ?? '')
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
