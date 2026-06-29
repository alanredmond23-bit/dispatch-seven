// dag-executor.ts — durable DAG executor for Turn 7
// Executes a task graph in topological order using Inngest for durability.
// Nodes with no unresolved deps run in parallel; nodes with deps wait.
// Writes node status/output to dispatch7.tasks.
//
// Turn 10 additions:
//   - retryWithBackoff: 3 attempts, exponential delay (500ms → 2s → 8s), jitter
//   - per-node 120s timeout via AbortController + Promise.race
//   - attempt count written to task payload for observability

import { inngest } from "./inngest.js";
import { supabase } from "./supabase.js";
import { loadAgent } from "./agent-loader.js";
import type { AgentDomain } from "./classifier.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type NodeStatus = "queued" | "running" | "done" | "failed";

export interface TaskNode {
  id: string;           // stable id within the graph (e.g. "t1")
  type: AgentDomain;    // maps to agent domain
  deps: string[];       // ids of nodes this node must wait for
  input: Record<string, unknown>; // arbitrary payload passed to the agent
}

export interface TaskGraph {
  nodes: TaskNode[];
}

// ── Retry + timeout config ─────────────────────────────────────────────────

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;   // 500ms → 2s → 8s (exponential × 4, +jitter)
const NODE_TIMEOUT_MS = 120_000;   // 2 minutes per node hard cap

/**
 * retryWithBackoff — execute fn up to maxAttempts times.
 * Delays: baseMs, baseMs*4, baseMs*16, ... + uniform jitter ±20%.
 * Does NOT retry if the error message contains "ANTHROPIC_API_KEY" (config error).
 */
async function retryWithBackoff<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  maxAttempts = RETRY_MAX_ATTEMPTS,
  baseDelayMs = RETRY_BASE_DELAY_MS
): Promise<{ result: T; attempts: number }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Per-attempt timeout via AbortController
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort(new Error(`Node timeout after ${NODE_TIMEOUT_MS}ms`));
    }, NODE_TIMEOUT_MS);

    try {
      const result = await fn(controller.signal);
      clearTimeout(timeoutHandle);
      return { result, attempts: attempt };
    } catch (err: unknown) {
      clearTimeout(timeoutHandle);
      lastError = err;

      const msg = err instanceof Error ? err.message : String(err);

      // Config errors (missing API key, unknown agent) are not retryable
      const isConfigError =
        msg.includes("ANTHROPIC_API_KEY") ||
        msg.includes("not set") ||
        msg.includes("Unknown agent");
      if (isConfigError) {
        throw err;
      }

      // Abort-caused timeouts are retryable (transient load spikes)
      console.warn(
        `[dag-executor] node attempt ${attempt}/${maxAttempts} failed: ${msg}`
      );

      if (attempt < maxAttempts) {
        // Exponential backoff with ±20% jitter
        const baseDelay = baseDelayMs * Math.pow(4, attempt - 1);
        const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1); // ±20%
        const delay = Math.max(0, Math.round(baseDelay + jitter));
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Map a node.id to the UUID row id inserted in dispatch7.tasks. */
type NodeIdMap = Record<string, string>; // node.id → uuid row id

/** Insert a single node row and return its uuid. */
async function insertNodeRow(
  sessionId: string,
  node: TaskNode
): Promise<string> {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title: `[${node.type}] ${String(node.input.query ?? node.input.instruction ?? node.id)}`.slice(0, 200),
      agent: node.type,
      status: "queued",
      payload: {
        session_id: sessionId,
        node_id: node.id,
        deps: node.deps,
        input: node.input,
        started_at: null,
        completed_at: null,
        output: null,
        retry_attempts: null,
      },
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`insertNodeRow failed for node ${node.id}: ${error?.message}`);
  }
  return data.id as string;
}

/** Resolve the uuid row id for a node.id using the map. */
function rowId(map: NodeIdMap, nodeId: string): string {
  const id = map[nodeId];
  if (!id) throw new Error(`No row id mapped for node id "${nodeId}"`);
  return id;
}

/** Update a task row's status and optional payload fields. */
async function updateNodeStatus(
  rowUuid: string,
  status: NodeStatus,
  extra?: {
    started_at?: string;
    completed_at?: string;
    output?: unknown;
    retry_attempts?: number;
  }
): Promise<void> {
  // Supabase JSONB merge — fetch existing payload first then upsert merged
  const { data: existing } = await supabase
    .from("tasks")
    .select("payload")
    .eq("id", rowUuid)
    .single();

  const merged = {
    ...(existing?.payload ?? {}),
    ...(extra ?? {}),
  };

  const { error } = await supabase
    .from("tasks")
    .update({ status, payload: merged })
    .eq("id", rowUuid);

  if (error) {
    console.error(`[dag-executor] updateNodeStatus failed for ${rowUuid}:`, error.message);
  }
}

/** Call the agent for a node and return the output.
 *  Accepts AbortSignal — passed to fetch so node timeout cancels the HTTP call.
 */
async function callAgent(
  node: TaskNode,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const config = await loadAgent(node.type);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const instruction =
    typeof node.input.instruction === "string"
      ? node.input.instruction
      : typeof node.input.query === "string"
      ? node.input.query
      : JSON.stringify(node.input);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      system: config.systemPrompt,
      messages: [{ role: "user", content: instruction }],
    }),
    signal, // propagate abort signal — timeout or graph cancellation
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }

  const json = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
  const text = json.content.find((b) => b.type === "text")?.text ?? "";
  return { text, usage: json.usage ?? null, agent: node.type };
}

// ── Cycle detection ────────────────────────────────────────────────────────

export function hasCycle(graph: TaskGraph): boolean {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const visited = new Set<string>();
  const inStack = new Set<string>();

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  function dfs(id: string): boolean {
    if (inStack.has(id)) return true;  // back edge = cycle
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    const node = nodeMap.get(id);
    for (const dep of node?.deps ?? []) {
      if (ids.has(dep) && dfs(dep)) return true;
    }
    inStack.delete(id);
    return false;
  }

  for (const node of graph.nodes) {
    if (dfs(node.id)) return true;
  }
  return false;
}

/** Return valid AgentDomain types. */
const VALID_TYPES: Set<string> = new Set([
  "LEGAL", "CODE", "RESEARCH", "SCHEDULER", "ORCHESTRATOR",
]);

export function validateGraph(graph: TaskGraph): string | null {
  if (!graph.nodes || graph.nodes.length === 0) return "graph must have at least one node";
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const node of graph.nodes) {
    if (!node.id?.trim()) return `node missing id`;
    if (!VALID_TYPES.has(node.type)) return `node ${node.id}: unknown type "${node.type}"`;
    for (const dep of node.deps) {
      if (!ids.has(dep)) return `node ${node.id}: dep "${dep}" not found in graph`;
    }
  }
  if (hasCycle(graph)) return "graph contains a cycle";
  return null;
}

// ── Topological execution ──────────────────────────────────────────────────

/**
 * Execute the DAG:
 * 1. Build NodeIdMap (node.id → db uuid) — rows already inserted by route
 * 2. Walk levels: nodes whose deps are all done run in parallel
 * 3. On failure: mark node + all transitive dependents failed
 *
 * Each node call uses retryWithBackoff (3 attempts, exponential) and a
 * per-node 120s hard timeout. Retry count written to task payload.
 */
export async function executeDag(
  sessionId: string,
  graph: TaskGraph,
  nodeIdMap: NodeIdMap
): Promise<void> {
  const done = new Set<string>();
  const failed = new Set<string>();
  const pending = new Set(graph.nodes.map((n) => n.id));

  // Precompute dependents map (who depends on me)
  const dependentsOf = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    if (!dependentsOf.has(node.id)) dependentsOf.set(node.id, new Set());
    for (const dep of node.deps) {
      if (!dependentsOf.has(dep)) dependentsOf.set(dep, new Set());
      dependentsOf.get(dep)!.add(node.id);
    }
  }

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  /** Recursively mark a node and all descendants failed. */
  async function cascadeFail(nodeId: string): Promise<void> {
    if (failed.has(nodeId)) return;
    failed.add(nodeId);
    pending.delete(nodeId);
    await updateNodeStatus(rowId(nodeIdMap, nodeId), "failed", {
      completed_at: new Date().toISOString(),
      output: { error: "upstream node failed" },
    });
    for (const dep of dependentsOf.get(nodeId) ?? []) {
      await cascadeFail(dep);
    }
  }

  /** Execute a single node with retry + timeout. */
  async function runNode(node: TaskNode): Promise<void> {
    const uuid = rowId(nodeIdMap, node.id);
    await updateNodeStatus(uuid, "running", { started_at: new Date().toISOString() });
    try {
      const { result: output, attempts } = await retryWithBackoff(
        (signal) => callAgent(node, signal)
      );
      await updateNodeStatus(uuid, "done", {
        completed_at: new Date().toISOString(),
        output,
        retry_attempts: attempts,
      });
      done.add(node.id);
      pending.delete(node.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[dag-executor] node ${node.id} failed after ${RETRY_MAX_ATTEMPTS} attempts:`, msg);
      await updateNodeStatus(uuid, "failed", {
        completed_at: new Date().toISOString(),
        output: { error: msg, retried: RETRY_MAX_ATTEMPTS },
      });
      failed.add(node.id);
      pending.delete(node.id);
      // Cascade to dependents
      for (const dep of dependentsOf.get(node.id) ?? []) {
        await cascadeFail(dep);
      }
    }
  }

  // Walk until all nodes resolved
  let iterations = 0;
  const MAX_ITER = graph.nodes.length + 5; // safety cap

  while (pending.size > 0 && iterations < MAX_ITER) {
    iterations++;

    // Find nodes ready to run: deps all done and not failed
    const ready = [...pending].filter((id) => {
      const node = nodeMap.get(id)!;
      return node.deps.every((d) => done.has(d));
    });

    // If nothing is ready but pending is non-empty, something is stuck (should not happen after cycle check)
    if (ready.length === 0) break;

    // Run all ready nodes in parallel
    await Promise.all(ready.map((id) => runNode(nodeMap.get(id)!)));
  }

  console.log(
    `[dag-executor] session=${sessionId} done=${done.size} failed=${failed.size} pending=${pending.size}`
  );
}

// ── Inngest function ───────────────────────────────────────────────────────
// Fires on "dispatch/dag.run" — durable wrapper around executeDag

export const dagRunnerFunction = inngest.createFunction(
  { id: "dag-runner", name: "DAG Runner" },
  { event: "dispatch/dag.run" },
  async ({ event, step }) => {
    const { session_id, graph, node_id_map } = event.data as {
      session_id: string;
      graph: TaskGraph;
      node_id_map: NodeIdMap;
    };

    await step.run("execute-dag", async () => {
      await executeDag(session_id, graph, node_id_map);
    });

    console.log(`[dagRunnerFunction] completed session=${session_id}`);
    return { session_id, node_count: graph.nodes.length };
  }
);
