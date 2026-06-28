// runs.ts — agent_runs cost dashboard routes
// GET  /api/v1/runs?session_id=X          — last 50 runs for session (omit = all)
// GET  /api/v1/runs/summary?session_id=X  — session + daily cost summary for CostBar
// POST /api/v1/runs/track                 — frontend reports usage after a Claude call
// POST /api/v1/runs/override-budget       — sets budget override flag for session (AUTH REQUIRED)
// GET  /api/v1/runs/task-graph            — session task graph for TaskGraph component

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";
import { trackRun } from "../lib/cost-tracker.js";
import { budgetOverrides } from "../lib/session-store.js";

const BUDGET_CAP_USD = parseFloat(process.env.BUDGET_CAP_USD ?? "1.00");

export const runsRoutes = new Hono();

// GET /api/v1/runs?session_id=X
runsRoutes.get("/", async (c) => {
  const session_id = c.req.query("session_id");

  let query = supabase
    .from("agent_runs")
    .select("id, session_id, agent, model, tokens_in, tokens_out, cost_usd, tool_calls, status, started_at, finished_at")
    .order("started_at", { ascending: false })
    .limit(50);

  if (session_id) query = query.eq("session_id", session_id);

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ runs: data ?? [], count: data?.length ?? 0 });
});

// GET /api/v1/runs/summary?session_id=X
// Returns CostBar payload: session totals, budget %, per-agent breakdown, daily total.
// Mounted BEFORE /:id so the literal "summary" is matched first.
runsRoutes.get("/summary", async (c) => {
  const session_id = c.req.query("session_id");

  // Start of today UTC — for daily rollup
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  // Parallel: session runs + today's runs across all sessions
  const [sessionResult, dailyResult] = await Promise.all([
    session_id
      ? supabase
          .from("agent_runs")
          .select("agent, cost_usd")
          .eq("session_id", session_id)
      : Promise.resolve({ data: [] as Array<{ agent: string; cost_usd: number | null }>, error: null }),
    supabase
      .from("agent_runs")
      .select("cost_usd")
      .gte("started_at", todayStart.toISOString()),
  ]);

  if (sessionResult.error) return c.json({ error: sessionResult.error.message }, 500);
  if (dailyResult.error)   return c.json({ error: dailyResult.error.message }, 500);

  // Aggregate session cost by agent
  const byAgentMap: Record<string, { cost_usd: number; run_count: number }> = {};
  let session_total_usd = 0;

  for (const row of sessionResult.data ?? []) {
    const key = row.agent as string;
    if (!byAgentMap[key]) byAgentMap[key] = { cost_usd: 0, run_count: 0 };
    const cost = Number(row.cost_usd ?? 0);
    byAgentMap[key].cost_usd  += cost;
    byAgentMap[key].run_count += 1;
    session_total_usd         += cost;
  }

  const by_agent = Object.entries(byAgentMap).map(([agent, v]) => ({
    agent,
    cost_usd:  v.cost_usd,
    run_count: v.run_count,
  }));

  const daily_total_usd = (dailyResult.data ?? []).reduce(
    (sum, r) => sum + Number(r.cost_usd ?? 0),
    0
  );

  const budget_pct = BUDGET_CAP_USD > 0
    ? Math.min(100, (session_total_usd / BUDGET_CAP_USD) * 100)
    : 0;

  return c.json({
    session_total_usd,
    budget_cap_usd:  BUDGET_CAP_USD,
    budget_pct,
    by_agent,
    daily_total_usd,
  });
});

// POST /api/v1/runs/track — frontend reports usage synchronously after a Claude call
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

// POST /api/v1/runs/override-budget
// Body: { session_id: string }
// Sets in-memory override so ws.ts budget check allows overage for this session.
// P0-3: Requires Authorization: Bearer matching API_BEARER_TOKEN.
// This endpoint directly controls the budget guard — must not be publicly accessible.
runsRoutes.post("/override-budget", async (c) => {
  const apiToken = process.env.API_BEARER_TOKEN;
  if (!apiToken) {
    return c.json({ error: "Server misconfigured: API_BEARER_TOKEN not set" }, 503);
  }

  const authHeader = c.req.header("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!token || token !== apiToken) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json<{ session_id: string }>();
  if (!body?.session_id) return c.json({ error: "session_id required" }, 400);
  budgetOverrides.add(body.session_id);
  return c.json({ ok: true, session_id: body.session_id, overridden: true });
});

// GET /api/v1/runs/task-graph?session_id=X
// Returns all tasks for session from dispatch7 — used by TaskGraph component (3s poll).
// Tasks are stored with payload->>'session_id' set at decompose time.
runsRoutes.get("/task-graph", async (c) => {
  const session_id = c.req.query("session_id");
  if (!session_id) return c.json({ tasks: [] });

  // Query tasks where payload contains our session_id
  // Supabase PostgREST JSON filter: payload->>'session_id' = X
  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("id, title, agent, status, payload, created_at")
    .filter("payload->>session_id", "eq", session_id)
    .order("created_at", { ascending: true });

  if (error) return c.json({ error: error.message }, 500);

  // Reshape for the frontend: pull estimated_cost_usd and dependencies from payload
  const shaped = (tasks ?? []).map((t) => ({
    id:                 t.id,
    title:              t.title,
    agent:              t.agent,
    status:             t.status,
    estimated_cost_usd: t.payload?.estimated_cost_usd ?? null,
    dependencies:       t.payload?.dependencies ?? [],
  }));

  return c.json({ tasks: shaped });
});
