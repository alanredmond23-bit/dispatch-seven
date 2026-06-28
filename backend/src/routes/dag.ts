// dag.ts — DAG execution routes for Turn 7
// POST /api/v1/dag/run    — validate, persist nodes, fire Inngest
// GET  /api/v1/dag/:session_id — poll node status from dispatch7.tasks

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";
import { inngest } from "../lib/inngest.js";
import {
  validateGraph,
  type TaskGraph,
  type TaskNode,
} from "../lib/dag-executor.js";

export const dagRoutes = new Hono();

// ── POST /api/v1/dag/run ──────────────────────────────────────────────────

dagRoutes.post("/run", async (c) => {
  const body = await c.req.json<{ session_id: string; graph: TaskGraph }>();
  const { session_id, graph } = body;

  if (!session_id?.trim()) return c.json({ error: "session_id is required" }, 400);
  if (!graph) return c.json({ error: "graph is required" }, 400);

  // Validate: no cycles, valid node types
  const validationError = validateGraph(graph);
  if (validationError) return c.json({ error: `Invalid graph: ${validationError}` }, 400);

  // Insert all nodes into dispatch7.tasks with status='queued'
  const inserts = graph.nodes.map((node: TaskNode) => ({
    title: `[${node.type}] ${String(node.input.query ?? node.input.instruction ?? node.id)}`.slice(0, 200),
    agent: node.type,
    status: "queued",
    payload: {
      session_id,
      node_id: node.id,
      deps: node.deps,
      input: node.input,
      started_at: null,
      completed_at: null,
      output: null,
    },
  }));

  const { data: inserted, error: insertErr } = await supabase
    .from("tasks")
    .insert(inserts)
    .select("id, payload");

  if (insertErr || !inserted) {
    return c.json({ error: `DB insert failed: ${insertErr?.message}` }, 500);
  }

  // Build node_id → uuid map so Inngest function can update rows by uuid
  const nodeIdMap: Record<string, string> = {};
  for (const row of inserted) {
    const nodeId = (row.payload as { node_id?: string })?.node_id;
    if (nodeId) nodeIdMap[nodeId] = row.id as string;
  }

  const dagRunId = `dag-${session_id}-${Date.now()}`;

  // Fire Inngest non-blocking
  await inngest.send({
    name: "dispatch/dag.run",
    data: {
      session_id,
      graph,
      node_id_map: nodeIdMap,
      dag_run_id: dagRunId,
    },
  });

  return c.json(
    {
      dag_run_id: dagRunId,
      node_count: graph.nodes.length,
      status: "started",
    },
    202
  );
});

// ── GET /api/v1/dag/:session_id ───────────────────────────────────────────

dagRoutes.get("/:session_id", async (c) => {
  const session_id = c.req.param("session_id");

  const { data, error } = await supabase
    .from("tasks")
    .select("id, agent, status, payload, created_at")
    .filter("payload->>session_id", "eq", session_id)
    .order("created_at", { ascending: true });

  if (error) return c.json({ error: error.message }, 500);

  const nodes = (data ?? []).map((row) => {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    return {
      id:           (p.node_id as string) ?? row.id,
      type:         row.agent,
      status:       row.status as string,
      started_at:   (p.started_at as string | null) ?? null,
      completed_at: (p.completed_at as string | null) ?? null,
      output:       (p.output as unknown) ?? null,
      deps:         (p.deps as string[]) ?? [],
    };
  });

  return c.json({ session_id, nodes });
});
