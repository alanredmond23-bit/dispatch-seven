// Agent registry routes
// GET  /api/v1/agents         — list all 12 agents + status
// GET  /api/v1/agents/:id     — single agent detail
// POST /api/v1/agents/:id/ping — heartbeat update

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";

export const agentRoutes = new Hono();

const AGENTS = [
  "ORCHESTRATOR","LEGAL","DISCOVERY","FINANCE",
  "BUILD","QA","RESEARCH","COMMS",
  "MEMORY","MONITOR","SCHEDULER","EXECUTE"
];

agentRoutes.get("/", async (c) => {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .order("name");
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ agents: data, count: data?.length ?? 0 });
});

agentRoutes.get("/:id", async (c) => {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("name", c.req.param("id").toUpperCase())
    .single();
  if (error) return c.json({ error: "Agent not found" }, 404);
  return c.json(data);
});

agentRoutes.post("/:id/ping", async (c) => {
  const name = c.req.param("id").toUpperCase();
  if (!AGENTS.includes(name)) return c.json({ error: "Unknown agent" }, 400);
  const { data, error } = await supabase
    .from("agents")
    .upsert({ name, last_ping: new Date().toISOString(), status: "active" })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});
