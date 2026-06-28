// routes/tasks.ts — GET /api/v1/tasks
// Returns task records for the TaskBoard component.
// Filters by session_id (via metadata->>'session_id') and active=true.
//
// P0: Bridges dispatch7.tasks → frontend TaskBoard polling endpoint.
// Maps tasks table columns + metadata JSON into TaskRecord shape.

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";

const app = new Hono();

// GET /api/v1/tasks?session_id=X&active=true
app.get("/", async (c) => {
  const sessionId = c.req.query("session_id");
  const activeOnly = c.req.query("active") === "true";

  if (!sessionId) {
    return c.json({ error: "session_id required" }, 400);
  }

  // Query tasks where metadata.session_id matches
  // active=true → status in ('in_progress', 'queued') OR completed within last 30min
  let query = supabase
    .from("tasks")
    .select("id, title, status, assigned_agent, metadata, updated_at")
    .filter("metadata->>session_id", "eq", sessionId)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (activeOnly) {
    // Return running/queued + recently completed (within 30 min)
    // Supabase doesn't support OR with computed dates easily — fetch all and filter in JS
    // P1: upgrade to proper RPC or composite index
  }

  const { data, error } = await query;

  if (error) {
    console.error("[tasks route] query error:", error.message);
    return c.json({ error: "Database error" }, 500);
  }

  // Map to TaskRecord shape expected by frontend TaskBoard
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const rows = (data ?? [])
    .filter((row) => {
      if (!activeOnly) return true;
      const meta = row.metadata as Record<string, unknown> ?? {};
      const completedAt = meta.completed_at as string | null;
      const isActive = row.status === "in_progress" || row.status === "queued";
      const isRecent = completedAt && completedAt > thirtyMinAgo;
      return isActive || isRecent;
    })
    .map((row) => {
      const meta = row.metadata as Record<string, unknown> ?? {};
      return {
        id:           row.id,
        title:        row.title,
        // Map back from tasks.status to TaskRecord status
        status:       row.status === "in_progress" ? "running"
                    : row.status === "completed"   ? "done"
                    : row.status === "failed"      ? "failed"
                    : "queued",
        progress_pct: (meta.progress_pct as number) ?? 0,
        agent_name:   (meta.agent_name as string) ?? row.assigned_agent ?? "AGENT",
        cost_usd:     (meta.cost_usd as number) ?? 0,
        started_at:   (meta.started_at as string) ?? null,
        completed_at: (meta.completed_at as string) ?? null,
        error:        (meta.error as string) ?? undefined,
      };
    });

  return c.json(rows);
});

export default app;
