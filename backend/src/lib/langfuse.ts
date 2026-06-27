// langfuse.ts — Langfuse observability client for D7
// Fire-and-forget tracing. Never throws — Langfuse down must not break request path.
// Ponytail: no wrappers beyond trace/span/score. Add evals when eval CI exists.

import { Langfuse } from "langfuse";

const PUBLIC_KEY  = process.env.LANGFUSE_PUBLIC_KEY  ?? "";
const SECRET_KEY  = process.env.LANGFUSE_SECRET_KEY  ?? "";
const HOST        = process.env.LANGFUSE_HOST         ?? "https://cloud.langfuse.com";

// Singleton — safe to reuse across requests
let _client: Langfuse | null = null;

function getClient(): Langfuse | null {
  if (!PUBLIC_KEY || !SECRET_KEY) return null; // keys not configured — skip silently
  if (!_client) {
    _client = new Langfuse({
      publicKey: PUBLIC_KEY,
      secretKey: SECRET_KEY,
      baseUrl:   HOST,
      flushAt:   10,
      flushInterval: 5000,
    });
  }
  return _client;
}

export interface TraceRunParams {
  traceId:   string;
  agentName: string;
  input:     string;
  output:    string;
  metadata?: Record<string, unknown>;
  costUsd?:  number;
}

/**
 * traceRun — record a complete agent run as a Langfuse trace + generation span + cost score.
 * Fire-and-forget: errors are logged, never thrown.
 */
export async function traceRun(params: TraceRunParams): Promise<void> {
  const lf = getClient();
  if (!lf) return; // not configured

  try {
    const trace = lf.trace({
      id:       params.traceId,
      name:     params.agentName,
      input:    params.input,
      output:   params.output,
      metadata: params.metadata ?? {},
    });

    const start = (params.metadata?.spanStart as string | undefined)
      ? new Date(params.metadata.spanStart as string)
      : undefined;
    const end = (params.metadata?.spanEnd as string | undefined)
      ? new Date(params.metadata.spanEnd as string)
      : undefined;

    // Span covering the Claude API call window
    trace.generation({
      name:        `${params.agentName}:claude-call`,
      model:       (params.metadata?.model as string | undefined) ?? "claude-sonnet-4-6",
      input:       params.input,
      output:      params.output,
      startTime:   start,
      endTime:     end,
      usage: {
        input:  (params.metadata?.inputTokens  as number | undefined) ?? 0,
        output: (params.metadata?.outputTokens as number | undefined) ?? 0,
      },
    });

    // Score the run with cost so Langfuse dashboard shows spend
    if (params.costUsd !== undefined) {
      trace.score({
        name:    "cost_usd",
        value:   params.costUsd,
        comment: `Session cost for trace ${params.traceId}`,
      });
    }
  } catch (err) {
    console.error("[Langfuse] traceRun error:", err);
  }
}

/**
 * flushLangfuse — drain pending events before process exit.
 * Call in graceful shutdown handler.
 */
export async function flushLangfuse(): Promise<void> {
  try {
    await _client?.flushAsync();
  } catch (err) {
    console.error("[Langfuse] flush error:", err);
  }
}
