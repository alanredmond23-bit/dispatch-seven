// cost-tracker.ts — agent run cost tracking for dispatch7.agent_runs
// Ponytail: no abstraction beyond what the schema demands.
// Usage: const tracker = trackRun({...}); const id = await tracker.start(); await tracker.finish(id, usage, []);

import { supabase } from "./supabase.js";

export type TrackRunParams = {
  session_id?: string;
  agent: string;
  model?: string;
  task_id?: string;
  project_id?: string;
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
};

// Per-token pricing (not per million — avoids division at call time)
const RATES = {
  // claude-sonnet-4-6 and claude-fable-5 use sonnet pricing
  sonnet: { input: 3e-6, output: 15e-6, cache_read: 3e-7 },
  // claude-haiku-* pricing
  haiku:  { input: 8e-7, output:  4e-6, cache_read: 8e-8 },
};

function getRates(model: string) {
  return model.includes("haiku") ? RATES.haiku : RATES.sonnet;
}

/** Pure cost calculation — exported for testing and for the /track endpoint */
export function calculateCost(
  model: string,
  tokens_in: number,
  tokens_out: number,
  cache_read = 0
): number {
  const r = getRates(model);
  return tokens_in * r.input + tokens_out * r.output + cache_read * r.cache_read;
}

/**
 * Returns { start, finish } bound to a single agent_runs row.
 * start()  — inserts the row (status='running'), returns the UUID
 * finish() — updates tokens, cost_usd, tool_calls, status='done'
 */
export function trackRun(params: TrackRunParams) {
  const {
    session_id,
    agent,
    model = "claude-sonnet-4-6",
    task_id,
    project_id,
  } = params;

  return {
    async start(): Promise<string> {
      const { data, error } = await supabase
        .from("agent_runs")
        .insert({
          session_id: session_id ?? null,
          agent,
          model,
          task_id: task_id ?? null,
          project_id: project_id ?? null,
          status: "running",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error) throw new Error(`cost-tracker start: ${error.message}`);
      return (data as { id: string }).id;
    },

    async finish(
      runId: string,
      usage: Usage,
      tool_calls: unknown[] = []
    ): Promise<void> {
      const cost_usd = calculateCost(
        model,
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_read_input_tokens ?? 0
      );

      const { error } = await supabase
        .from("agent_runs")
        .update({
          tokens_in: usage.input_tokens,
          tokens_out: usage.output_tokens,
          cost_usd,
          tool_calls,
          status: "done",
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);

      if (error) throw new Error(`cost-tracker finish: ${error.message}`);
    },
  };
}
