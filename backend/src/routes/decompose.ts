// POST /api/decompose
// Body: { goal: string, budget_usd?: number }
// Calls Claude via decomposer agent → inserts project, tasks, task_graph edges
// Returns: { project_id, project_title, tasks: [{id, title, agent, priority, depends_on:[]}] }

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";
import { decompose } from "../../../agents/decomposer.js";

export const decomposeRoutes = new Hono();

decomposeRoutes.post("/", async (c) => {
  const body = await c.req.json<{ goal: string; budget_usd?: number }>();
  const { goal, budget_usd } = body;

  if (!goal?.trim()) return c.json({ error: "goal is required" }, 400);

  // 1. Call Claude → parsed plan (with built-in retry on invalid JSON)
  let plan;
  try {
    plan = await decompose(goal);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Decomposition failed: ${msg}` }, 502);
  }

  // 2. Insert project row
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

  // 3. Insert task rows — collect ids in order so we can build graph edges
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

  // 4. Build task_graph edges from depends_on_indices
  const edges: Array<{ task_id: string; depends_on: string }> = [];
  plan.tasks.forEach((t, idx) => {
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

  // 5. Assemble response — include depends_on uuid arrays for orchestrator
  const idByIndex = insertedTasks.map((t) => t.id);
  const tasks = insertedTasks.map((t, idx) => ({
    ...t,
    depends_on: (plan.tasks[idx].depends_on_indices ?? []).map((i: number) => idByIndex[i]),
  }));

  return c.json({ project_id: project.id, project_title: project.title, tasks }, 201);
});
