// routes/sessions.ts — active session listing for Dashboard
// Turn 10: GET /api/v1/sessions
// Derives session summaries from dispatch7.agent_runs (no separate sessions table needed).
// Returns sessions active in the last 24h with cost, message count, domain, last agent.

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";

export const sessionRoutes = new Hono();

interface SessionRow {
  session_id: string;
  last_agent: string;
  total_cost_usd: number;
  run_count: number;
  last_activity: string;
  domain: string;
}

// GET /api/v1/sessions
// Returns active sessions (runs in last 24h), aggregated by session_id.
// Frontend useSessions hook polls this every 5s.
sessionRoutes.get("/", async (c) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Fetch raw runs and aggregate in-process.
  // Note: Could use dispatch7.v_active_sessions view once migration 009 is applied.
  // Doing it in JS for portability — works even before the view exists.
  const { data, error } = await supabase
    .schema("dispatch7")
    .from("agent_runs")
    .select("session_id, agent, cost_usd, status, started_at")
    .gte("started_at", since)
    .not("session_id", "is", null)
    .order("started_at", { ascending: false })
    .limit(500); // enough to cover a busy 24h window

  if (error) {
    console.error("[sessions] query error:", error.message);
    return c.json({ error: "Database error" }, 500);
  }

  // Aggregate per session_id
  const map = new Map<string, SessionRow & { agents: Set<string> }>();

  for (const row of data ?? []) {
    const sid = row.session_id as string;
    if (!sid) continue;

    if (!map.has(sid)) {
      map.set(sid, {
        session_id:     sid,
        last_agent:     row.agent as string,
        total_cost_usd: 0,
        run_count:      0,
        last_activity:  row.started_at as string,
        domain:         "general",
        agents:         new Set(),
      });
    }

    const s = map.get(sid)!;
    s.run_count       += 1;
    s.total_cost_usd  += Number(row.cost_usd ?? 0);
    s.agents.add(row.agent as string);

    // Keep last_activity as most recent started_at
    if ((row.started_at as string) > s.last_activity) {
      s.last_activity = row.started_at as string;
      s.last_agent    = row.agent as string;
    }
  }

  // Derive domain from agent set — priority order matches v_active_sessions view
  const domainPriority: Array<[string, string]> = [
    ["LEGAL",    "legal"],
    ["RESEARCH", "research"],
    ["FINANCE",  "finance"],
    ["BUILD",    "engineering"],
  ];

  const sessions: SessionRow[] = Array.from(map.values())
    .map(({ agents, ...s }) => {
      for (const [agentName, domainLabel] of domainPriority) {
        if (agents.has(agentName)) {
          s.domain = domainLabel;
          break;
        }
      }
      s.total_cost_usd = Math.round(s.total_cost_usd * 10000) / 10000;
      return s;
    })
    .sort((a, b) => b.last_activity.localeCompare(a.last_activity));

  return c.json({ sessions, count: sessions.length });
});

// GET /api/v1/sessions/:session_id/messages
// Returns recent agent_runs for a session as a message feed.
// Dashboard center panel polls this for the selected session.
sessionRoutes.get("/:session_id/messages", async (c) => {
  const session_id = c.req.param("session_id");
  const limit      = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 100);

  const { data, error } = await supabase
    .schema("dispatch7")
    .from("agent_runs")
    .select("id, agent, model, status, cost_usd, started_at, finished_at, instruction, tool_calls")
    .eq("session_id", session_id)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) return c.json({ error: error.message }, 500);

  // Map runs to message-like shape for the frontend feed
  const messages = (data ?? []).map((run) => ({
    id:          run.id,
    agent:       run.agent,
    model:       run.model,
    status:      run.status,
    cost_usd:    run.cost_usd,
    started_at:  run.started_at,
    finished_at: run.finished_at,
    // instruction is not selected in basic runs query — include if column exists
    instruction: (run as Record<string, unknown>).instruction ?? null,
    tool_count:  Array.isArray(run.tool_calls) ? run.tool_calls.length : 0,
  }));

  return c.json({ messages, session_id });
});
