// runs.ts — agent_runs cost dashboard routes
// GET  /api/v1/runs?session_id=X  — last 50 runs for session (omit param = all)
// GET  /api/v1/runs/summary       — total cost_usd by agent, last 30 days
// POST /api/v1/runs/track         — frontend reports usage after a Claude API call

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";
import { trackRun } from "../lib/cost-tracker.js";

export const runsRoutes = new Hono();

// GET /api/v1/runs?session_id=X
runsRoutes.get("/", async (c) => {
  const session_id = c.req.query("session_id");

  let query = supabase
    .from("agent_runs")
    .select("id, session_id, agent, model, tokens_in, tokens_out, cost_usd, tool_calls, status, started_at, finished_at")
    .order("started_at", { ascending: false })
    .limit(50);

  // Filter by session if provided; otherwise return latest 50 across all sessions
  if (session_id) query = query.eq("session_id", session_id);

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ runs: data ?? [], count: data?.length ?? 0 });
});

// GET /api/v1/runs/summary — 30-day cost rollup by agent
// Note: mounted BEFORE "/:id" so the literal "summary" is matched first
runsRoutes.get("/summary", async (c) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("agent_runs")
    .select("agent, cost_usd, tokens_in, tokens_out")
    .gte("started_at", since)
    .eq("status", "done");

  if (error) return c.json({ error: error.message }, 500);

  // Ponytail: aggregate in JS — avoids an RPC for this data volume
  const byAgent: Record<string, { cost_usd: number; runs: number; tokens_in: number; tokens_out: number }> = {};
  let total_cost_usd = 0;

  for (const row of data ?? []) {
    const key = row.agent as string;
    if (!byAgent[key]) byAgent[key] = { cost_usd: 0, runs: 0, tokens_in: 0, tokens_out: 0 };
    const cost = Number(row.cost_usd ?? 0);
    byAgent[key].cost_usd   += cost;
    byAgent[key].runs       += 1;
    byAgent[key].tokens_in  += row.tokens_in  ?? 0;
    byAgent[key].tokens_out += row.tokens_out ?? 0;
    total_cost_usd          += cost;
  }

  return c.json({ period_days: 30, total_cost_usd, by_agent: byAgent });
});

// POST /api/v1/runs/track — frontend reports usage synchronously after a Claude call
// Body: { session_id?, agent, model?, task_id?, project_id?, usage: {input_tokens, output_tokens, cache_read_input_tokens?}, tool_calls? }
runsRoutes.post("/track", async (c) => {
  const body = await c.req.json() as {
    session_id?: string;
    agent: string;
    model?: string;
    task_id?: string;
    project_id?: string;
    usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
    tool_calls?: unknown[];
  };

  const { agent, usage } = body;
  if (!agent || !usage) return c.json({ error: "agent and usage are required" }, 400);

  // start() + finish() in one shot — we already have the usage data
  const tracker = trackRun({
    session_id:  body.session_id,
    agent,
    model:       body.model,
    task_id:     body.task_id,
    project_id:  body.project_id,
  });

  const runId = await tracker.start();
  await tracker.finish(runId, usage, body.tool_calls ?? []);

  return c.json({ id: runId, ok: true });
});
