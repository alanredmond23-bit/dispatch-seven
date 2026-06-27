// Actions route — D7 dispatch7.actions
// GET  /api/v1/actions?session_id=X   — pending actions for a session
// POST /api/v1/actions                — insert action (called by agent parser)
// POST /api/v1/actions/:id/execute   — mark executed, return prompt for re-submission

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";

export const actionRoutes = new Hono();

// GET /api/v1/actions?session_id=X
actionRoutes.get("/", async (c) => {
  const session_id = c.req.query("session_id");
  if (!session_id) return c.json({ error: "session_id required" }, 400);

  const { data, error } = await supabase
    .from("actions")
    .select("*")
    .eq("session_id", session_id)
    .eq("executed", false)
    .order("created_at", { ascending: true });

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ actions: data ?? [] });
});

// POST /api/v1/actions — insert a new action row
actionRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const { session_id, label, prompt, style = "primary" } = body;

  if (!session_id || !label || !prompt) {
    return c.json({ error: "session_id, label, and prompt are required" }, 400);
  }

  const { data, error } = await supabase
    .from("actions")
    .insert({ session_id, label, prompt, style })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

// POST /api/v1/actions/:id/execute
actionRoutes.post("/:id/execute", async (c) => {
  const id = c.req.param("id");

  const { data, error } = await supabase
    .from("actions")
    .update({ executed: true, executed_at: new Date().toISOString() })
    .eq("id", id)
    .select("prompt")
    .single();

  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "Action not found" }, 404);
  return c.json({ prompt: data.prompt });
});
