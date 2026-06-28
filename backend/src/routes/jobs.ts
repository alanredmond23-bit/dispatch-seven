// routes/jobs.ts — Inngest job trigger + status polling
// Turn 9: async job queue API
// POST /api/v1/jobs/trigger { type, payload } — creates job_runs record, sends Inngest event
// GET  /api/v1/jobs/status/:job_id            — polls job_runs for current state + result
// Job state is stored in dispatch7.job_runs (migration 009) so Inngest REST API auth is not needed.

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";
import { inngest } from "../lib/inngest.js";

export const jobRoutes = new Hono();

type JobType = "research" | "summary" | "deadline_sweep";

interface TriggerBody {
  type: JobType;
  payload: Record<string, unknown>;
}

// POST /api/v1/jobs/trigger
// Body: { type: JobType, payload: object }
// 1. Creates a job_runs row (status='queued') — returns job_id immediately
// 2. Sends the appropriate Inngest event with the job_id embedded so the function can mark state
jobRoutes.post("/trigger", async (c) => {
  let body: TriggerBody;
  try {
    body = await c.req.json<TriggerBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { type, payload } = body;
  if (!type || !["research", "summary", "deadline_sweep"].includes(type)) {
    return c.json({ error: "type must be one of: research, summary, deadline_sweep" }, 400);
  }

  // Create job_runs row to track state
  const { data: jobRow, error: insertError } = await supabase
    .schema("dispatch7")
    .from("job_runs")
    .insert({
      job_type:   type,
      session_id: (payload.session_id as string) ?? null,
      payload,
      status:     "queued",
    })
    .select("id, created_at")
    .single();

  if (insertError) {
    console.error("[jobs/trigger] insert error:", insertError.message);
    return c.json({ error: "Failed to create job record" }, 500);
  }

  const job_id = jobRow.id as string;

  // Map job type → Inngest event name + data shape
  // job_id is passed so the Inngest function can update job_runs status
  try {
    switch (type) {
      case "research":
        await inngest.send({
          name: "dispatch/job.research",
          data: {
            job_id,
            query:      (payload.query as string) ?? "",
            session_id: (payload.session_id as string) ?? "anon",
          },
        });
        break;

      case "summary":
        await inngest.send({
          name: "dispatch/job.summary",
          data: {
            job_id,
            session_id:    (payload.session_id as string) ?? "anon",
            message_limit: (payload.message_limit as number) ?? 20,
          },
        });
        break;

      case "deadline_sweep":
        // deadline_sweep runs on cron but can also be manually triggered
        await inngest.send({
          name: "dispatch/job.deadline_sweep",
          data: { job_id, triggered_by: "manual" },
        });
        break;
    }
  } catch (sendError) {
    // Mark as failed if event send throws — Inngest dev server not running locally is common
    console.error("[jobs/trigger] Inngest send error:", (sendError as Error).message);
    await supabase
      .schema("dispatch7")
      .from("job_runs")
      .update({ status: "failed", error: (sendError as Error).message, updated_at: new Date().toISOString() })
      .eq("id", job_id);

    return c.json({ error: "Failed to dispatch job event", detail: (sendError as Error).message }, 502);
  }

  return c.json({
    job_id,
    type,
    status: "queued",
    created_at: jobRow.created_at,
  }, 202);
});

// GET /api/v1/jobs/status/:job_id
// Returns current state of a job: status, elapsed_ms, result, error
// Frontend JobQueue polls this at 10s interval
jobRoutes.get("/status/:job_id", async (c) => {
  const job_id = c.req.param("job_id");
  if (!job_id) return c.json({ error: "job_id required" }, 400);

  const { data, error } = await supabase
    .schema("dispatch7")
    .from("job_runs")
    .select("id, job_type, session_id, status, payload, result, error, created_at, updated_at")
    .eq("id", job_id)
    .single();

  if (error || !data) {
    return c.json({ error: "Job not found" }, 404);
  }

  const createdAt  = new Date(data.created_at as string).getTime();
  const updatedAt  = new Date(data.updated_at as string).getTime();
  const elapsed_ms = updatedAt - createdAt;

  return c.json({
    job_id:     data.id,
    type:       data.job_type,
    session_id: data.session_id,
    status:     data.status,
    elapsed_ms,
    result:     data.result ?? null,
    error:      data.error ?? null,
    created_at: data.created_at,
    updated_at: data.updated_at,
  });
});

// GET /api/v1/jobs?session_id=X&limit=20
// Returns recent jobs for a session — used by JobQueue component initial load
jobRoutes.get("/", async (c) => {
  const session_id = c.req.query("session_id");
  const limit      = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 50);

  let query = supabase
    .schema("dispatch7")
    .from("job_runs")
    .select("id, job_type, session_id, status, result, error, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (session_id) query = query.eq("session_id", session_id);

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  const now = Date.now();
  const jobs = (data ?? []).map((row) => ({
    job_id:     row.id,
    type:       row.job_type,
    session_id: row.session_id,
    status:     row.status,
    elapsed_ms: now - new Date(row.created_at as string).getTime(),
    result:     row.result ?? null,
    error:      row.error ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return c.json({ jobs, count: jobs.length });
});
