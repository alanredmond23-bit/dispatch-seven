// D7 WebSocket transport — bidirectional streaming (Anthropic + OpenAI-compatible)
// Route: GET /ws?session_id=<id>
// Replaces direct frontend→Anthropic fetch with backend-proxied streaming.
// SSE endpoint (/api/v1/stream) left intact as fallback for older clients.
//
// Provider routing:
//   'anthropic' → native Anthropic SSE fetch (original path, unchanged)
//   'openai' | 'groq' | 'ollama' → OpenAI SDK with baseURL override
//
// Message protocol (client → server):
//   { type: "message", content: string, session_id: string }
//   { type: "pong" }
//
// Message protocol (server → client):
//   { type: "token",  content: string }          — streaming token
//   { type: "done",   session_id: string }        — stream complete
//   { type: "error",  message: string }           — error
//   { type: "ping" }                              — heartbeat (30s)
//
// Turn 12 additions:
//   - AbortController per streaming call: onClose aborts active Anthropic stream
//     → no more orphaned HTTP calls burning tokens after the user closes the tab
//   - Per-session message queue: if a stream is already active when a new message
//     arrives, it is queued and processed sequentially (no concurrent stream races)

import type { UpgradeWebSocket } from "hono/ws";
import OpenAI from "openai";
import { trackRun } from "../lib/cost-tracker.js";
import { getRelevantContext, addMemory } from "../lib/mem0.js";
import { traceRun } from "../lib/langfuse.js";
import { supabase } from "../lib/supabase.js";
import { extractCitations, verifyCitation } from "../lib/citation-extractor.js";
import { parseAndInsertActions } from "../middleware/actions-parser.js";
import { classifyMessage } from "../lib/classifier.js";
import { loadAgent } from "../lib/agent-loader.js";
import { budgetOverrides } from "../lib/session-store.js";
import type { ProviderConfig } from "../lib/provider.js";

const ANTHROPIC_URL    = "https://api.anthropic.com/v1/messages";
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS  = 10_000;

// ── BUDGET CAP ───────────────────────────────────────────────────────────────
// Per-session hard cap. Set BUDGET_CAP_USD in env; default $1.00.
const BUDGET_CAP_USD = parseFloat(process.env.BUDGET_CAP_USD ?? "1.00");

async function checkBudget(sessionId: string): Promise<void> {
  const { data, error } = await supabase
    .from("agent_runs")
    .select("cost_usd")
    .eq("session_id", sessionId);

  if (error) {
    console.warn(`[budget] query failed for session=${sessionId}: ${error.message}`);
    return;
  }

  const totalSpend = (data ?? []).reduce(
    (sum: number, row: { cost_usd: number | null }) => sum + (row.cost_usd ?? 0),
    0
  );

  if (totalSpend >= BUDGET_CAP_USD && !budgetOverrides.has(sessionId)) {
    throw new BudgetCapError(totalSpend);
  }
}

class BudgetCapError extends Error {
  constructor(public readonly spend: number) {
    super(`Budget cap reached ($${spend.toFixed(4)}). Reset session to continue.`);
  }
}

// Build citation appendix from extracted + verified citations
async function buildCitationBlock(fullText: string): Promise<string> {
  const citations = extractCitations(fullText);
  if (!citations.length) {
    return "\n\n---\n**CITATIONS**\n⚠️ No citations extracted — legal claims should be verified manually.";
  }

  const verified = await Promise.all(
    citations.map(async (c) => {
      const result = await verifyCitation(c.citation);
      return { ...c, ...result };
    })
  );

  const lines = verified.map((c) => {
    const status = c.verified ? "✓" : "[UNVERIFIED]";
    const link = c.url ? ` — ${c.url}` : "";
    return `- ${c.citation} ${status}${link}`;
  });

  return "\n\n---\n**CITATIONS**\n" + lines.join("\n");
}

// ── ANTHROPIC STREAMING ───────────────────────────────────────────────────────
// Original Anthropic SSE path — preserved unchanged for 'anthropic' provider.
async function streamAnthropic(
  config: ProviderConfig,
  content: string,
  onToken: (tok: string) => void,
  systemPrompt?: string,
  maxTokens = 4096
): Promise<{ input_tokens: number; output_tokens: number; fullResponse: string }> {
  const usage = { input_tokens: 0, output_tokens: 0 };
  if (!config.apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const body: Record<string, unknown> = {
    model:      config.model,
    max_tokens: maxTokens,
    stream:     true,
    messages:   [{ role: "user", content }],
  };
  if (systemPrompt) body.system = systemPrompt;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal, // Turn 12: kills the TCP connection when signal fires
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }

  const reader  = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let fullResponse = "";

  while (true) {
    // Turn 12: check abort between chunks
    if (signal?.aborted) {
      await reader.cancel();
      throw new Error("Stream aborted by client disconnect");
    }

    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return { ...usage, fullResponse };
      try {
        const evt = JSON.parse(data);
        if (evt.type === "message_start" && evt.message?.usage) {
          usage.input_tokens = evt.message.usage.input_tokens ?? 0;
        } else if (evt.type === "message_delta" && evt.usage) {
          usage.output_tokens = evt.usage.output_tokens ?? 0;
        } else if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
          onToken(evt.delta.text);
          fullResponse += evt.delta.text;
        }
      } catch { /* malformed JSON line — skip */ }
    }
  }
  return { ...usage, fullResponse };
}

// ── OPENAI-COMPATIBLE STREAMING ───────────────────────────────────────────────
// Handles OpenAI, Groq, Ollama. All use the same OpenAI SDK with baseURL override.
// Token counts: OpenAI/Groq return usage on the final chunk; Ollama may not.
async function streamOpenAI(
  config: ProviderConfig,
  content: string,
  onToken: (tok: string) => void,
  systemPrompt?: string,
  maxTokens = 4096
): Promise<{ input_tokens: number; output_tokens: number; fullResponse: string }> {
  const client = new OpenAI({
    apiKey:  config.apiKey,
    baseURL: config.baseURL,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content });

  // stream_options.include_usage: returns token counts on the final [DONE] chunk
  const stream = await client.chat.completions.create({
    model:          config.model,
    messages,
    max_tokens:     maxTokens,
    stream:         true,
    stream_options: { include_usage: true },
  });

  let fullResponse = "";
  let input_tokens  = 0;
  let output_tokens = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      onToken(delta);
      fullResponse += delta;
    }
    // usage arrives on the last chunk when stream_options.include_usage is set
    if (chunk.usage) {
      input_tokens  = chunk.usage.prompt_tokens     ?? 0;
      output_tokens = chunk.usage.completion_tokens ?? 0;
    }
  }

  return { input_tokens, output_tokens, fullResponse };
}

// ── UNIFIED STREAMING ENTRY POINT ─────────────────────────────────────────────
// Routes to Anthropic or OpenAI path based on providerConfig.type.
async function streamWithProvider(
  config: ProviderConfig,
  content: string,
  onToken: (tok: string) => void,
  systemPrompt?: string,
  maxTokens = 4096
): Promise<{ input_tokens: number; output_tokens: number; fullResponse: string }> {
  if (config.type === "anthropic") {
    return streamAnthropic(config, content, onToken, systemPrompt, maxTokens);
  }
  return streamOpenAI(config, content, onToken, systemPrompt, maxTokens);
}

// ── WS HANDLER ───────────────────────────────────────────────────────────────
export function buildWsHandler(upgradeWebSocket: UpgradeWebSocket) {
  return upgradeWebSocket((c) => {
    const sessionId = c.req.query("session_id") ?? "unknown";
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let pongTimer: ReturnType<typeof setTimeout>  | null = null;

    return {
      onOpen(_evt, ws) {
        console.log(`[WS] open session=${sessionId}`);

        pingTimer = setInterval(() => {
          try {
            ws.send(JSON.stringify({ type: "ping" }));
            pongTimer = setTimeout(() => {
              console.warn(`[WS] pong timeout session=${sessionId} — closing`);
              ws.close(1001, "pong timeout");
            }, PONG_TIMEOUT_MS);
          } catch { /* socket already closed */ }
        }, PING_INTERVAL_MS);
      },

      async onMessage(evt, ws) {
        const raw = typeof evt.data === "string"
          ? evt.data
          : Buffer.from(evt.data as ArrayBuffer).toString();

        let msg: { type: string; content?: string; session_id?: string; agent?: string };
        try {
          msg = JSON.parse(raw);
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
          return;
        }

        if (msg.type === "pong") {
          if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
          return;
        }

        if (msg.type !== "message" || !msg.content) {
          ws.send(JSON.stringify({ type: "error", message: "Expected {type:'message', content:string}" }));
          return;
        }

        const sid = msg.session_id ?? sessionId;
        const state = getSessionState(sid);

        // Turn 12: queue if a stream is already active for this session
        if (state.processing) {
          state.queue.push({ content: msg.content, agentOverride: msg.agent });
          ws.send(JSON.stringify({
            type: "queued",
            position: state.queue.length,
            session_id: sid,
          }));
          return;
        }

        // Process the message (and then drain the queue)
        await processMessageAndDrainQueue(sid, msg.content, msg.agent, ws);
      },

      onClose(_evt, _ws) {
        console.log(`[WS] close session=${sessionId}`);
        if (pingTimer) clearInterval(pingTimer);
        if (pongTimer) clearTimeout(pongTimer);

        // Turn 12: abort any active stream for this session
        const state = sessionState.get(sessionId);
        if (state?.controller) {
          console.log(`[WS] aborting active stream for session=${sessionId}`);
          state.controller.abort();
        }
        // Clear session state on close — WS is gone, queued messages are irrelevant
        sessionState.delete(sessionId);
      },

      onError(evt, _ws) {
        console.error(`[WS] error session=${sessionId}`, evt);
        if (pingTimer) clearInterval(pingTimer);
        if (pongTimer) clearTimeout(pongTimer);
        // Also abort on error
        const state = sessionState.get(sessionId);
        if (state?.controller) state.controller.abort();
        sessionState.delete(sessionId);
      },
    };
  });
}

// ── CORE PROCESSING ───────────────────────────────────────────────────────────
// Extracted from onMessage for queue draining. Processes one message then
// recursively picks up queued messages until queue is empty.

async function processMessageAndDrainQueue(
  sid: string,
  userMessage: string,
  agentFromMsg: string | undefined,
  ws: { send: (data: string) => void; close: (code?: number, reason?: string) => void }
): Promise<void> {
  const state = getSessionState(sid);
  state.processing = true;

  // Turn 12: create an AbortController for this stream
  const controller = new AbortController();
  state.controller = controller;

  const domain = classifyMessage(userMessage);
  const agentConfig = await loadAgent(domain);
  const agentLabel = agentFromMsg ?? domain;
  console.log(`[WS] message session=${sid} len=${userMessage.length} agent=${agentLabel}`);

  ws.send(JSON.stringify({ type: "route", agent: domain, model: agentConfig.model, provider: agentConfig.provider }));

  const taskId      = `task-${sid}-${Date.now()}`;
  const taskStarted = new Date().toISOString();
  writeTaskStatus({
    task_id:      taskId,
    session_id:   sid,
    title:        userMessage.slice(0, 80) + (userMessage.length > 80 ? "…" : ""),
    status:       "running",
    progress_pct: 5,
    agent_name:   agentLabel,
    cost_usd:     0,
    started_at:   taskStarted,
  }).catch(console.error);

  let systemPrompt: string | undefined = agentConfig.systemPrompt;
  try {
    const memCtx = await getRelevantContext(sid, userMessage);
    if (memCtx) {
      systemPrompt = `${agentConfig.systemPrompt}\n\n---\nMemories from prior sessions:\n${memCtx}`;
    }
  } catch {
    // Mem0 down — proceed without context
  }

  try {
    await checkBudget(sid);
  } catch (err: unknown) {
    if (err instanceof BudgetCapError) {
      ws.send(JSON.stringify({ type: "error", message: err.message }));
      ws.close(1008, "budget cap reached");
      state.processing = false;
      state.controller = null;
      return;
    }
    console.error("[budget] unexpected error:", err);
  }

  const traceId   = `${sid}-${Date.now()}`;
  const spanStart = new Date().toISOString();
  let   outputBuf = "";

  const tracker = trackRun({ session_id: sid, agent: agentLabel, model: agentConfig.model });
  const runId   = await tracker.start().catch(() => null);

  try {
    const { fullResponse, ...usage } = await streamWithProvider(
      agentConfig.providerConfig,
      userMessage,
      (token) => {
        outputBuf += token;
        ws.send(JSON.stringify({ type: "token", content: token }));
      },
      systemPrompt,
      agentConfig.maxTokens
    );

    if (domain === "LEGAL" && fullResponse) {
      const citationBlock = await buildCitationBlock(fullResponse);
      outputBuf += citationBlock;
      ws.send(JSON.stringify({ type: "token", content: citationBlock }));
    }

    try {
      await parseAndInsertActions(fullResponse, sid);
    } catch (actErr) {
      console.error("[actions-parser] non-fatal:", actErr);
    }
    if (domain === "SCHEDULER" && fullResponse) {
      try {
        const schedParsed = parseSchedulerOutput(fullResponse);
        if (schedParsed && schedParsed.tasks.length > 0) {
          await upsertScheduledTasks(schedParsed, sid);
        }
      } catch (schedErr) {
        console.error("[scheduler-runner] non-fatal:", schedErr);
      }
    }

    try {
      const routeMatch = fullResponse.match(
        /\{[^{}]*"agent"\s*:\s*"([A-Z]+)"[^{}]*"task"\s*:\s*"([^"]+)"[^{}]*\}/
      );
      if (routeMatch) {
        const backendBase = `http://localhost:${process.env.PORT ?? "3001"}`;
        fetch(`${backendBase}/api/v1/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sid,
            agent: "ORCHESTRATOR",
            type:  "spawn_task",
            payload: { target_agent: routeMatch[1], task_title: routeMatch[2] },
          }),
        }).catch(() => {/* non-fatal */});
      }
    } catch {
      // non-fatal
    }

    ws.send(JSON.stringify({ type: "done", session_id: sid }));

    const spanEnd = new Date().toISOString();
    if (runId) tracker.finish(runId, usage).catch(console.error);

    const { calculateCost: calcCostDone } = await import("../lib/cost-tracker.js");
    const finalCost = calcCostDone("claude-sonnet-4-6", usage.input_tokens, usage.output_tokens);
    writeTaskStatus({
      task_id:      taskId,
      session_id:   sid,
      title:        userMessage.slice(0, 80) + (userMessage.length > 80 ? "…" : ""),
      status:       "done",
      progress_pct: 100,
      agent_name:   agentLabel,
      cost_usd:     finalCost,
      started_at:   taskStarted,
    }).catch(console.error);

    const { calculateCost } = await import("../lib/cost-tracker.js");
    const costUsd = calculateCost(agentConfig.model, usage.input_tokens, usage.output_tokens);

    traceRun({
      traceId,
      agentName: agentLabel,
      input:     userMessage,
      output:    outputBuf,
      costUsd,
      metadata: {
        session_id:   sid,
        model:        agentConfig.model,
        inputTokens:  usage.input_tokens,
        outputTokens: usage.output_tokens,
        spanStart,
        spanEnd,
        isLegal:      domain === "LEGAL",
      },
    }).catch(console.error);

    addMemory(sid, [
      { role: "user",      content: userMessage  },
      { role: "assistant", content: fullResponse },
    ]).catch(() => {/* Mem0 down — silent */});

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Turn 12: "Stream aborted by client disconnect" is expected — don't spam error to a closed socket
    const isAbort = message.includes("aborted") || message.includes("abort");
    if (!isAbort) {
      console.error(`[WS] stream error session=${sid}:`, message);
      try {
        ws.send(JSON.stringify({ type: "error", message }));
      } catch {/* ws may be closed */}
    } else {
      console.log(`[WS] stream cleanly aborted for session=${sid} — client disconnected`);
    }

    writeTaskStatus({
      task_id:      taskId,
      session_id:   sid,
      title:        userMessage.slice(0, 80) + (userMessage.length > 80 ? "…" : ""),
      status:       "failed",
      progress_pct: 0,
      agent_name:   agentLabel,
      cost_usd:     0,
      started_at:   taskStarted,
      error:        message,
    }).catch(console.error);
  } finally {
    // Turn 12: clear stream state
    state.processing = false;
    state.controller = null;

    // Turn 12: drain the queue — process next message if one is waiting
    if (state.queue.length > 0) {
      const next = state.queue.shift()!;
      // Fire-and-forget — next message processes asynchronously
      processMessageAndDrainQueue(sid, next.content, next.agentOverride, ws).catch(
        (err) => console.error("[WS] queue drain error:", err)
      );
    }
  }
}

// ── P0: TASK STATUS WRITER ────────────────────────────────────────────────────

export interface TaskStatusPayload {
  task_id:      string;
  session_id:   string;
  title:        string;
  status:       "queued" | "running" | "done" | "failed";
  progress_pct: number;
  agent_name:   string;
  cost_usd:     number;
  started_at?:  string;
  error?:       string;
}

export async function writeTaskStatus(payload: TaskStatusPayload): Promise<void> {
  const {
    task_id, session_id, title, status, progress_pct,
    agent_name, cost_usd, started_at, error,
  } = payload;

  const { error: dbErr } = await supabase
    .from("tasks")
    .upsert(
      {
        id:             task_id,
        title,
        status:         status === "running" ? "in_progress"
                      : status === "done"    ? "completed"
                      : status,
        assigned_agent: agent_name,
        metadata: {
          session_id,
          progress_pct,
          cost_usd,
          agent_name,
          started_at:   started_at ?? new Date().toISOString(),
          completed_at: (status === "done" || status === "failed")
                          ? new Date().toISOString()
                          : null,
          error: error ?? null,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

  if (dbErr) {
    console.warn(`[writeTaskStatus] upsert failed task_id=${task_id}: ${dbErr.message}`);
  }
}
