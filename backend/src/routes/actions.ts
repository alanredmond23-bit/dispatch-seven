// Actions route — D7 dispatch7.actions
// GET  /api/v1/actions?session_id=X&limit=20  — action log for a session (agent/type/payload schema)
// POST /api/v1/actions                         — insert action (agent runner or button-action schema)
// POST /api/v1/actions/:id/execute             — mark executed, return prompt for re-submission

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";

export const actionRoutes = new Hono();

// GET /api/v1/actions?session_id=X&limit=20
// Returns action log sorted by created_at DESC.
// Supports both action-log rows {agent, type, payload} and button-action rows {label, prompt, style}.
actionRoutes.get("/", async (c) => {
  const session_id = c.req.query("session_id");
  if (!session_id) return c.json({ error: "session_id required" }, 400);

  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);

  const { data, error } = await supabase
    .from("actions")
    .select("id, session_id, agent, type, payload, label, prompt, style, created_at")
    .eq("session_id", session_id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

// POST /api/v1/actions
// Accepts two schemas:
//   Agent-log:    { session_id, agent, type, payload }   — spawned tasks, routing events
//   Button-action: { session_id, label, prompt, style }  — CopilotKit quick-action buttons
actionRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const { session_id } = body;
  if (!session_id) return c.json({ error: "session_id required" }, 400);

  // Agent-log schema: agent + type required
  if (body.agent && body.type) {
    const { agent, type, payload } = body;
    const { data, error } = await supabase
      .from("actions")
      .insert({ session_id, agent, type, payload: payload ?? null })
      .select()
      .single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data, 201);
  }

  // Button-action schema: label + prompt required
  const { label, prompt, style = "primary" } = body;
  if (!label || !prompt) {
    return c.json({ error: "provide either {agent, type} or {label, prompt}" }, 400);
  }

  const { data, error } = await supabase
    .from("actions")
    .insert({ session_id, label, prompt, style })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

// POST /api/v1/actions/:id/execute — mark button-action as executed, return its prompt
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
