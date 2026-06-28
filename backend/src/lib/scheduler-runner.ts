// scheduler-runner.ts — SCHEDULER agent output → dispatch7.tasks persistence
//
// Responsibilities:
//   1. Parse SCHEDULER agent JSON output (SchedulerResponse type)
//   2. Upsert task entries to dispatch7.tasks with due_date + domain columns
//   3. Expose GET handler: upcoming tasks sorted by due_date for SchedulerPanel
//
// Schema note: dispatch7.tasks has domain TEXT (existing), due_date TIMESTAMPTZ (migration T11)
// Migration: scripts/migrations/0011_add_due_date_to_tasks.sql

import { Hono } from "hono";
import { supabase } from "./supabase.js";

// ── TYPES ─────────────────────────────────────────────────────────────────────

export type SchedulerPriority = "p0" | "p1" | "p2" | "p3";
export type SchedulerDomain   = "LEGAL" | "CODE" | "RESEARCH" | "PERSONAL" | "FINANCE" | "SCHEDULER";

export interface SchedulerTask {
  title:    string;
  due_date: string | null;  // ISO 8601 or null
  priority: SchedulerPriority;
  domain:   SchedulerDomain;
  notes:    string | null;
}

export interface SchedulerResponse {
  action:  "create" | "list" | "remind" | "update" | "delete";
  tasks:   SchedulerTask[];
  summary: string;
}

// What we return from GET /upcoming — typed for SchedulerPanel
export interface UpcomingTask {
  id:         string;
  title:      string;
  due_date:   string | null;
  priority:   string;
  domain:     string;
  notes:      string | null;
  days_until: number | null;
  overdue:    boolean;
}

// ── PARSE + VALIDATE ─────────────────────────────────────────────────────────
// Safe parse: if the model returns markdown-fenced JSON, strip fences first.
// Returns null on parse failure — callers should log + continue.
export function parseSchedulerOutput(raw: string): SchedulerResponse | null {
  // Strip markdown code fences if present (model sometimes wraps despite prompt)
  const stripped = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```$/m, "").trim();
  try {
    const parsed = JSON.parse(stripped);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.action === "string" &&
      Array.isArray(parsed.tasks)
    ) {
      return parsed as SchedulerResponse;
    }
    return null;
  } catch {
    return null;
  }
}

// ── UPSERT TASKS ──────────────────────────────────────────────────────────────
// Takes parsed SchedulerResponse, upserts each task to dispatch7.tasks.
// Uses title + due_date as a natural dedup key (via generated deterministic ID).
// Returns count of rows upserted.
//
// Ponytail: deterministic ID = base64(title+due_date) for idempotent upsert.
// P1 upgrade: per-session tasks with session_id FK.
export async function upsertScheduledTasks(
  response: SchedulerResponse,
  sessionId?: string
): Promise<{ upserted: number; errors: string[] }> {
  if (response.action === "list" || response.tasks.length === 0) {
    return { upserted: 0, errors: [] };
  }

  const errors: string[] = [];
  let upserted = 0;

  for (const task of response.tasks) {
    // Stable ID: sha-ish from title + due_date — avoids duplicate rows on re-send
    // Using btoa is not available in Node; use Buffer instead
    const rawKey  = `${task.title}|${task.due_date ?? "nodate"}`;
    const stableId = Buffer.from(rawKey).toString("base64url").slice(0, 36).padEnd(36, "0");

    const row: Record<string, unknown> = {
      id:         stableId,
      title:      task.title,
      status:     "open",
      domain:     task.domain,
      priority:   task.priority,
      due_date:   task.due_date ?? null,
      updated_at: new Date().toISOString(),
      metadata: {
        notes:      task.notes ?? null,
        session_id: sessionId ?? null,
        source:     "SCHEDULER",
        created_at: new Date().toISOString(),
      },
    };

    // assigned_agent = "SCHEDULER" so tasks.ts route can filter by agent
    row.assigned_agent = "SCHEDULER";

    const { error } = await supabase
      .from("tasks")
      .upsert(row, { onConflict: "id" });

    if (error) {
      const msg = `upsert failed for "${task.title}": ${error.message}`;
      console.error(`[scheduler-runner] ${msg}`);
      errors.push(msg);
    } else {
      upserted++;
    }
  }

  return { upserted, errors };
}

// ── FETCH UPCOMING ────────────────────────────────────────────────────────────
// Returns tasks from dispatch7.tasks where:
//   - assigned_agent = 'SCHEDULER' (created by this runner)
//   - due_date is not null
//   - ordered by due_date ASC (soonest first)
// Optional: filter by domain, limit (default 50)
export async function fetchUpcomingTasks(opts?: {
  domain?: SchedulerDomain;
  limit?: number;
  includeOverdue?: boolean;
}): Promise<UpcomingTask[]> {
  const { domain, limit = 50, includeOverdue = true } = opts ?? {};

  let query = supabase
    .from("tasks")
    .select("id, title, due_date, priority, domain, metadata, status")
    .eq("assigned_agent", "SCHEDULER")
    .not("due_date", "is", null)
    .order("due_date", { ascending: true })
    .limit(limit);

  if (domain) query = query.eq("domain", domain);
  if (!includeOverdue) query = query.gte("due_date", new Date().toISOString());

  const { data, error } = await query;
  if (error) {
    console.error(`[scheduler-runner] fetchUpcoming error: ${error.message}`);
    return [];
  }

  const now = Date.now();

  return (data ?? []).map((row) => {
    const meta   = (row.metadata as Record<string, unknown>) ?? {};
    const dueMs  = row.due_date ? new Date(row.due_date).getTime() : null;
    const daysUntil = dueMs !== null
      ? Math.ceil((dueMs - now) / 86_400_000)
      : null;

    return {
      id:         row.id as string,
      title:      row.title as string,
      due_date:   row.due_date as string | null,
      priority:   row.priority as string,
      domain:     row.domain as string,
      notes:      (meta.notes as string) ?? null,
      days_until: daysUntil,
      overdue:    daysUntil !== null && daysUntil < 0,
    };
  });
}

// ── HONO ROUTE ────────────────────────────────────────────────────────────────
// GET /api/v1/schedule?domain=LEGAL&limit=20&includeOverdue=true
// POST /api/v1/schedule — accepts raw SCHEDULER agent JSON output, upserts tasks
export const schedulerRoutes = new Hono();

schedulerRoutes.get("/", async (c) => {
  const domain        = c.req.query("domain") as SchedulerDomain | undefined;
  const limit         = parseInt(c.req.query("limit") ?? "50");
  const includeOverdue = c.req.query("includeOverdue") !== "false";

  const tasks = await fetchUpcomingTasks({ domain, limit, includeOverdue });
  return c.json({ tasks, count: tasks.length });
});

schedulerRoutes.post("/", async (c) => {
  const body       = await c.req.text();
  const sessionId  = c.req.query("session_id");

  const parsed = parseSchedulerOutput(body);
  if (!parsed) {
    return c.json({ error: "Invalid SCHEDULER agent output — expected JSON with action + tasks" }, 400);
  }

  const { upserted, errors } = await upsertScheduledTasks(parsed, sessionId);

  return c.json({
    action:   parsed.action,
    upserted,
    errors,
    summary:  parsed.summary,
  }, errors.length === 0 ? 200 : 207);
});
