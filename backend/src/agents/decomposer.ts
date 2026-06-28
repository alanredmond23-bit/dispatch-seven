// DECOMPOSER agent — goal → ordered task DAG
// ponytail: native fetch only, no new deps
// Called by POST /api/decompose before orchestrator executes the returned queue

export const DECOMPOSER_SYSTEM = `You decompose goals into ordered tasks for a 12-agent AI system.
Given a goal, return ONLY valid JSON:
{
  "title": string,
  "domain": string,
  "tasks": [
    {
      "title": string,
      "agent": string,
      "priority": 1-10,
      "payload": { "instruction": string },
      "depends_on_indices": [0, 1, ...]
    }
  ]
}
agents: LEGAL|DISCOVERY|FINANCE|BUILD|QA|RESEARCH|COMMS|MEMORY|MONITOR|SCHEDULER|EXECUTE
depends_on_indices: array of task indices this task must wait for (empty = can start immediately)
No markdown, no explanation, JSON only.`.trim();

export interface DecomposedTask {
  title: string;
  agent: string;
  priority: number;
  payload: { instruction: string };
  depends_on_indices: number[];
}

export interface DecomposedPlan {
  title: string;
  domain: string;
  tasks: DecomposedTask[];
}

/** Call Claude once (with one retry on invalid JSON) and return parsed plan */
export async function decompose(goal: string): Promise<DecomposedPlan> {
  const result = await callClaude(goal);
  try {
    return JSON.parse(result) as DecomposedPlan;
  } catch {
    // Retry once with an explicit correction prompt
    const corrected = await callClaude(
      goal,
      `Your previous response was not valid JSON. Return ONLY the JSON object, no markdown, no explanation.\nGoal: ${goal}`
    );
    return JSON.parse(corrected) as DecomposedPlan;
  }
}

async function callClaude(goal: string, override?: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: DECOMPOSER_SYSTEM,
      messages: [{ role: "user", content: override ?? `Decompose this goal into tasks: ${goal}` }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const json = (await res.json()) as { content: Array<{ type: string; text: string }> };
  const text = json.content.find((b) => b.type === "text")?.text ?? "";
  // Strip any accidental markdown fences
  return text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
}
