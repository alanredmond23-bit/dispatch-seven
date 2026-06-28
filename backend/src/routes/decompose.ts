// decompose.ts — two decompose endpoints:
//   POST /api/decompose      — original project DAG decomposer (existing, untouched)
//   POST /api/v1/decompose   — session-scoped Haiku pre-planner for CostBar/TaskGraph UI
//   (both are exported; index.ts mounts them at different paths)

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";
import { decompose, DecomposedTask } from "../agents/decomposer.js";

// ── ORIGINAL ROUTE — /api/decompose ─────────────────────────────────────────
export const decomposeRoutes = new Hono();

decomposeRoutes.post("/", async (c) => {
  const body = await c.req.json<{ goal: string; budget_usd?: number }>();
  const { goal, budget_usd } = body;

  if (!goal?.trim()) return c.json({ error: "goal is required" }, 400);

  let plan;
  try {
    plan = await decompose(goal);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Decomposition failed: ${msg}` }, 502);
  }

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .insert({
      title: plan.title,
      goal,
      domain: plan.domain,
      status: "planning",
      budget_usd: budget_usd ?? null,
    })
    .select("id, title")
    .single();

  if (projErr || !project) {
    return c.json({ error: projErr?.message ?? "project insert failed" }, 500);
  }

  const taskInserts = plan.tasks.map((t) => ({
    project_id: project.id,
    title: t.title,
    agent: t.agent,
    priority: t.priority,
    payload: t.payload,
    status: "queued",
  }));

  const { data: insertedTasks, error: taskErr } = await supabase
    .from("tasks")
    .insert(taskInserts)
    .select("id, title, agent, priority");

  if (taskErr || !insertedTasks) {
    return c.json({ error: taskErr?.message ?? "task insert failed" }, 500);
  }

  const edges: Array<{ task_id: string; depends_on: string }> = [];
  plan.tasks.forEach((t: DecomposedTask, idx: number) => {
    for (const depIdx of t.depends_on_indices ?? []) {
      if (depIdx < insertedTasks.length && idx < insertedTasks.length) {
        edges.push({
          task_id: insertedTasks[idx].id,
          depends_on: insertedTasks[depIdx].id,
        });
      }
    }
  });

  if (edges.length > 0) {
    const { error: graphErr } = await supabase.from("task_graph").insert(edges);
    if (graphErr) return c.json({ error: graphErr.message }, 500);
  }

  const idByIndex = insertedTasks.map((t) => t.id);
  const tasks = insertedTasks.map((t, idx) => ({
    ...t,
    depends_on: (plan.tasks[idx].depends_on_indices ?? []).map((i: number) => idByIndex[i]),
  }));

  return c.json({ project_id: project.id, project_title: project.title, tasks }, 201);
});

// ── SESSION-SCOPED ROUTE — /api/v1/decompose ─────────────────────────────────
// POST { session_id, goal } → Haiku decomposes → stores tasks with payload.session_id
// Returns task graph the UI renders immediately.
export const v1DecomposeRoutes = new Hono();

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const DECOMPOSE_SYSTEM = `Decompose this goal into 3-7 concrete subtasks.
Return ONLY valid JSON array, no markdown, no explanation:
[{"id":"t1","title":"...","agent":"ORCHESTRATOR","dependencies":[],"estimated_cost_usd":0.002}]
Agents available: ORCHESTRATOR, LEGAL, CODE, RESEARCH, SCHEDULER.
Keep tasks atomic and executable. Assign realistic cost estimates (Haiku ~$0.001, Sonnet ~$0.005 per task).
dependencies: array of id strings this task must wait for. First tasks have [].`.trim();

interface HaikuTask {
  id: string;
  title: string;
  agent: string;
  dependencies: string[];
  estimated_cost_usd: number;
}

async function callHaiku(goal: string): Promise<HaikuTask[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system:     DECOMPOSE_SYSTEM,
      messages:   [{ role: "user", content: goal }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content.find((b) => b.type === "text")?.text ?? "[]";
  // Strip accidental markdown fences
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned) as HaikuTask[];
}

v1DecomposeRoutes.post("/", async (c) => {
  const body = await c.req.json<{ session_id: string; goal: string }>();
  const { session_id, goal } = body;
  if (!goal?.trim())     return c.json({ error: "goal is required" }, 400);
  if (!session_id)       return c.json({ error: "session_id is required" }, 400);

  let haikuTasks: HaikuTask[];
  try {
    haikuTasks = await callHaiku(goal);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Haiku decomposition failed: ${msg}` }, 502);
  }

  // Store tasks in dispatch7.tasks with payload carrying session metadata
  // so GET /api/v1/runs/task-graph?session_id=X can retrieve them cheaply.
  const taskInserts = haikuTasks.map((t) => ({
    title:  t.title,
    agent:  t.agent,
    status: "pending",
    // project_id left null — these are session-scoped planning tasks, not project tasks
    payload: {
      session_id,
      haiku_id:          t.id,
      dependencies:      t.dependencies,
      estimated_cost_usd: t.estimated_cost_usd,
    },
  }));

  const { data: inserted, error: insertErr } = await supabase
    .from("tasks")
    .insert(taskInserts)
    .select("id, title, agent, status, payload");

  if (insertErr) {
    // Non-fatal — return haiku tasks even if DB insert fails (client still renders)
    console.error("[v1/decompose] DB insert failed:", insertErr.message);
    return c.json({ tasks: haikuTasks, persisted: false }, 201);
  }

  // Reshape to match what TaskGraph expects
  const tasks = (inserted ?? []).map((row) => ({
    id:                 row.id,
    title:              row.title,
    agent:              row.agent,
    status:             row.status,
    dependencies:       row.payload?.dependencies ?? [],
    estimated_cost_usd: row.payload?.estimated_cost_usd ?? null,
  }));

  return c.json({ tasks, persisted: true }, 201);
});
