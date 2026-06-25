// Shared memory routes — cross-agent state store
// GET  /api/v1/memory/:key   — retrieve value
// POST /api/v1/memory        — set key/value
// DELETE /api/v1/memory/:key — clear key

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";

export const memoryRoutes = new Hono();

memoryRoutes.get("/:key", async (c) => {
  const { data, error } = await supabase
    .from("memory")
    .select("*")
    .eq("key", c.req.param("key"))
    .single();
  if (error) return c.json({ error: "Key not found" }, 404);
  return c.json(data);
});

memoryRoutes.post("/", async (c) => {
  const { key, value, agent, ttl_seconds } = await c.req.json();
  const expires_at = ttl_seconds
    ? new Date(Date.now() + ttl_seconds * 1000).toISOString()
    : null;
  const { data, error } = await supabase
    .from("memory")
    .upsert({ key, value, agent, expires_at, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

memoryRoutes.delete("/:key", async (c) => {
  const { error } = await supabase
    .from("memory")
    .delete()
    .eq("key", c.req.param("key"));
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ deleted: c.req.param("key") });
});
