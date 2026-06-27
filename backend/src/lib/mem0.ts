// Mem0 cloud memory client — cross-session context for Claude
// userId = session_id until auth is wired; swap to real user_id after.
// All functions: fire-and-forget safe. Mem0 down = silent pass-through.

import MemoryClient from "mem0ai";
import { supabase } from "./supabase.js";

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

  // Also sync assistant turn to Supabase audit trail
  const assistantMsg = messages.find((m) => m.role === "assistant");
  if (assistantMsg) {
    supabase
      .schema("dispatch7")
      .from("memory")
      .insert({
        session_id: userId,
        content: assistantMsg.content.slice(0, 500),
        metadata: { role: "assistant", via: "mem0" },
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
