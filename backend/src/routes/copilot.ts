// CopilotKit runtime endpoint — POST /api/copilot
// Returns available agent actions based on session state.
// ponytail: static action list — dynamic context-aware suggestions when usage data exists

import { Hono } from "hono";

export const copilotRoutes = new Hono();

// Static action registry — each entry maps to a CopilotKit useCopilotAction registration
const AVAILABLE_ACTIONS = [
  {
    name: "ask_legal_agent",
    label: "Ask legal agent",
    description: "Route this query to the legal analysis agent",
    prompt: "Ask the legal agent: {input}",
    contexts: ["legal", "all"],
  },
  {
    name: "decompose_goal",
    label: "Decompose this goal",
    description: "Break the current goal into a structured task DAG",
    prompt: "Decompose this goal into actionable steps: {input}",
    contexts: ["planning", "all"],
  },
  {
    name: "schedule_followup",
    label: "Schedule follow-up",
    description: "Set a follow-up reminder tied to this session",
    prompt: "Schedule a follow-up for: {input}",
    contexts: ["scheduling", "all"],
  },
  {
    name: "check_cost",
    label: "Check cost",
    description: "Report current token usage and estimated cost for this session",
    prompt: "Check the cost and token usage for this session",
    contexts: ["cost", "all"],
  },
  {
    name: "search_memory",
    label: "Search memory",
    description: "Search persistent memory for relevant context",
    prompt: "Search memory for: {input}",
    contexts: ["memory", "all"],
  },
] as const;

// POST /api/copilot — CopilotKit runtime calls this to resolve available actions
// session_context is optional; filters to relevant actions when provided
copilotRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    session_id?: string;
    session_context?: string;
  };

  const context = body.session_context ?? "all";

  // Filter actions to those matching the current context (always include "all")
  const actions = AVAILABLE_ACTIONS.filter(
    (a) => a.contexts.includes("all") || a.contexts.includes(context as never)
  );

  return c.json({ actions });
});
