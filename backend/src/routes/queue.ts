// routes/queue.ts — queue stats and enqueue API
// GET  /api/v1/jobs/queue-stats  — current runner depth, active tasks, capacity
// POST /api/v1/jobs/enqueue      — enqueue an agent task with priority
//
// Integration with globalTaskRunner (lib/task-runner.ts).
// The enqueue endpoint is for lightweight in-process tasks — heavy durable jobs
// still go through Inngest. Use this for real-time interactive tasks that need
// priority ordering without Inngest overhead.

import { Hono } from "hono";
import { globalTaskRunner, Priority, parsePriority } from "../lib/task-runner.js";

export const queueRoutes = new Hono();

// GET /api/v1/jobs/queue-stats
// Returns runner stats for the ops dashboard and /health extended view.
queueRoutes.get("/queue-stats", (c) => {
  return c.json(globalTaskRunner.stats());
});

// POST /api/v1/jobs/enqueue
// Body: { agent: string, instruction: string, session_id?: string, priority?: "CRITICAL"|"HIGH"|"NORMAL"|"LOW" }
// Enqueues a lightweight agent task in the global runner.
// Returns { id, priority, queued_at } — caller can poll /api/v1/tasks/:id for result.
queueRoutes.post("/enqueue", async (c) => {
  const body = await c.req.json<{
    agent?: string;
    instruction?: string;
    session_id?: string;
    priority?: string;
  }>();

  if (!body?.agent || !body?.instruction) {
    return c.json({ error: "agent and instruction are required" }, 400);
  }

  const priority = parsePriority(body.priority);
  const taskId   = crypto.randomUUID();

  // Fire-and-forget enqueue — result is written to dispatch7.tasks
  globalTaskRunner.enqueue(async () => {
    // Minimal in-process agent call: POST to own /api/v1/agents/:agent
    const port = process.env.PORT ?? "3001";
    const res = await fetch(`http://localhost:${port}/api/v1/agents/${body.agent}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: body.instruction,
        session_id:  body.session_id,
        task_id:     taskId,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Agent ${body.agent} returned ${res.status}: ${text}`);
    }
    return res.json();
  }, priority).catch((err: unknown) => {
    // Log task failure — caller must poll task status for error details
    console.error(`[queue] task ${taskId} failed:`, err instanceof Error ? err.message : String(err));
  });

  return c.json({
    id:         taskId,
    priority:   ["CRITICAL", "HIGH", "NORMAL", "LOW"][priority],
    queued_at:  new Date().toISOString(),
    queue_depth: globalTaskRunner.stats().queued.depth,
  });
});
