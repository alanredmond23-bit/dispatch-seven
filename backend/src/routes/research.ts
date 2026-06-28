// research.ts — POST /api/v1/research
// Direct invocation of the RESEARCH agent with Tavily search + Claude synthesis.
// Used when classifier routes domain=RESEARCH and caller wants structured output
// rather than a streamed chat response.

import { Hono } from "hono";
import { runResearchAgent } from "../agents/research.js";

export const researchRoutes = new Hono();

// POST /api/v1/research
// Body: { session_id: string, query: string }
// Returns: ResearchResult JSON
researchRoutes.post("/", async (c) => {
  const body = await c.req.json<{ session_id: string; query: string }>();
  const { session_id, query } = body;

  if (!query?.trim())   return c.json({ error: "query is required" }, 400);
  if (!session_id)      return c.json({ error: "session_id is required" }, 400);

  try {
    const result = await runResearchAgent({ query, session_id });
    return c.json(result, 200);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[research route] error:", msg);
    return c.json({ error: `Research agent failed: ${msg}` }, 502);
  }
});
