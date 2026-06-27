// Memory routes — cross-session Mem0-backed store
// GET    /api/v1/memory?session_id=X  — search memories for session
// DELETE /api/v1/memory?session_id=X  — clear all memories for session
//
// Legacy key-value routes (pre-S2) removed; Mem0 is the memory layer now.

import { Hono } from "hono";
import { searchMemory } from "../lib/mem0.js";
import MemoryClient from "mem0ai";

export const memoryRoutes = new Hono();

function getClient(): MemoryClient | null {
  const key = process.env.MEM0_API_KEY;
  if (!key) return null;
  return new MemoryClient({ api_key: key });
}

memoryRoutes.get("/", async (c) => {
  const sessionId = c.req.query("session_id");
  if (!sessionId) return c.json({ error: "session_id required" }, 400);

  const query = c.req.query("q") ?? "";
  const memories = await searchMemory(sessionId, query || sessionId);
  return c.json({ memories });
});

memoryRoutes.delete("/", async (c) => {
  const sessionId = c.req.query("session_id");
  if (!sessionId) return c.json({ error: "session_id required" }, 400);

  try {
    const client = getClient();
    if (!client) return c.json({ error: "MEM0_API_KEY not configured" }, 503);
    // Mem0 delete_all scoped to user_id
    await (client as any).delete_all({ user_id: sessionId });
    return c.json({ cleared: sessionId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});
