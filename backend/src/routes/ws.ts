// D7 WebSocket transport — bidirectional Claude streaming
// Route: GET /ws?session_id=<id>
// Replaces direct frontend→Anthropic fetch with backend-proxied streaming.
// SSE endpoint (/api/v1/stream) left intact as fallback for older clients.
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

import type { UpgradeWebSocket } from "hono/ws";
import { trackRun } from "../lib/cost-tracker.js";
import { getRelevantContext, addMemory } from "../lib/mem0.js";
import { traceRun } from "../lib/langfuse.js";
import { supabase } from "../lib/supabase.js";
import { extractCitations, verifyCitation } from "../lib/citation-extractor.js";
import { parseAndInsertActions } from "../middleware/actions-parser.js";
import { classifyMessage } from "../lib/classifier.js";
import { loadAgent } from "../lib/agent-loader.js";

const ANTHROPIC_URL    = "https://api.anthropic.com/v1/messages";
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS  = 5_000;

// ── BUDGET CAP ───────────────────────────────────────────────────────────────
// Per-session hard cap. Set BUDGET_CAP_USD in env; default $1.00.
// Ponytail: session-level cap — per-user caps when multi-tenant
const BUDGET_CAP_USD = parseFloat(process.env.BUDGET_CAP_USD ?? "1.00");

/**
 * checkBudget — returns the current session spend.
 * Throws if BUDGET_CAP_USD is exceeded.
 */
async function checkBudget(sessionId: string): Promise<void> {
  const { data, error } = await supabase
    .from("agent_runs")
    .select("cost_usd")
    .eq("session_id", sessionId);

  if (error) {
    // Supabase unavailable — fail open (do not block the request)
    console.warn(`[budget] query failed for session=${sessionId}: ${error.message}`);
    return;
  }

  const totalSpend = (data ?? []).reduce(
    (sum: number, row: { cost_usd: number | null }) => sum + (row.cost_usd ?? 0),
    0
  );

  if (totalSpend >= BUDGET_CAP_USD) {
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

  // Verify all citations in parallel with 3s timeout each
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

// ── CLAUDE STREAMING ─────────────────────────────────────────────────────────
// Stream Claude tokens, calling onToken per chunk.
// Returns { input_tokens, output_tokens, fullResponse } captured from SSE events.
// systemPrompt: prepended context (mem0 injection, legal system prompt, etc.)
async function streamClaude(
  content: string,
  onToken: (tok: string) => void,
  systemPrompt?: string,
  model = "claude-sonnet-4-6",
  maxTokens = 4096
): Promise<{ input_tokens: number; output_tokens: number; fullResponse: string }> {
  const usage = { input_tokens: 0, output_tokens: 0 };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    stream:     true,
    messages: [{ role: "user", content }],
  };
  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
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
        } else if (
          evt.type === "content_block_delta" &&
          evt.delta?.type === "text_delta"
        ) {
          onToken(evt.delta.text);
          fullResponse += evt.delta.text;
        }
      } catch {
        // malformed JSON line — skip
      }
    }
  }
  return { ...usage, fullResponse };
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
          } catch {
            // socket already closed
          }
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
        const userMessage = msg.content;

        // ── AGENT ROUTING — classify message, load agent config ─────────────
        const agentFromMsg = msg.agent;
        const domain = classifyMessage(userMessage);
        const agentConfig = loadAgent(domain);
        const agentLabel = agentFromMsg ?? domain;
        console.log(`[WS] message session=${sid} len=${userMessage.length} agent=${agentLabel}`);

        // ── ROUTE INDICATOR — tell frontend which agent is handling this ──────
        ws.send(JSON.stringify({ type: "route", agent: domain, model: agentConfig.model }));

        // --- Mem0: fetch relevant context from prior sessions ---
        let systemPrompt: string | undefined = agentConfig.systemPrompt;
        try {
          const memCtx = await getRelevantContext(sid, userMessage);
          if (memCtx) {
            systemPrompt = `${agentConfig.systemPrompt}\n\n---\nMemories from prior sessions:\n${memCtx}`;
          }
        } catch {
          // Mem0 down — proceed without context
        }

        // ── BUDGET CHECK (before any Anthropic call) ────────────────────────
        try {
          await checkBudget(sid);
        } catch (err: unknown) {
          if (err instanceof BudgetCapError) {
            ws.send(JSON.stringify({ type: "error", message: err.message }));
            ws.close(1008, "budget cap reached");
            return;
          }
          // Any other budget-check error: fail open, log, continue
          console.error("[budget] unexpected error:", err);
        }

        // ── LANGFUSE TRACE SETUP ────────────────────────────────────────────
        const traceId   = `${sid}-${Date.now()}`;
        const spanStart = new Date().toISOString();
        let   outputBuf = ""; // accumulate output for Langfuse

        // Cost tracking: start row before Claude call
        const tracker = trackRun({ session_id: sid, agent: agentLabel, model: agentConfig.model });
        const runId   = await tracker.start().catch(() => null);

        try {
          const { fullResponse, ...usage } = await streamClaude(
            userMessage,
            (token) => {
              outputBuf += token;
              ws.send(JSON.stringify({ type: "token", content: token }));
            },
            systemPrompt,
            agentConfig.model,
            agentConfig.maxTokens
          );

          // Legal responses: extract and verify citations, then stream the citation block
          if (domain === "LEGAL" && fullResponse) {
            const citationBlock = await buildCitationBlock(fullResponse);
            // Stream citation block as additional tokens so the client receives it inline
            outputBuf += citationBlock;
            ws.send(JSON.stringify({ type: "token", content: citationBlock }));
          }

          // FIX A: wire actions parser — extract and persist embedded action blocks
          try {
            await parseAndInsertActions(fullResponse, sid);
          } catch (actErr) {
            console.error("[actions-parser] non-fatal:", actErr);
          }

          ws.send(JSON.stringify({ type: "done", session_id: sid }));

          const spanEnd = new Date().toISOString();

          // Cost tracking — fire-and-forget so WS response isn't delayed
          if (runId) tracker.finish(runId, usage).catch(console.error);

          // ── LANGFUSE: trace + span + cost score ─────────────────────────
          // Wrapped in try/catch — Langfuse down must not affect WS handler
          const { calculateCost } = await import("../lib/cost-tracker.js");
          const costUsd = calculateCost(
            agentConfig.model,
            usage.input_tokens,
            usage.output_tokens
          );

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
              isLegal:      legal,
            },
          }).catch(console.error); // truly fire-and-forget

          // --- Mem0: store conversation turn after response ---
          addMemory(sid, [
            { role: "user",      content: userMessage  },
            { role: "assistant", content: fullResponse },
          ]).catch(() => {/* Mem0 down — silent */});

        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[WS] stream error session=${sid}:`, message);
          ws.send(JSON.stringify({ type: "error", message }));
        }
      },

      onClose(_evt, _ws) {
        console.log(`[WS] close session=${sessionId}`);
        if (pingTimer) clearInterval(pingTimer);
        if (pongTimer) clearTimeout(pongTimer);
      },

      onError(evt, _ws) {
        console.error(`[WS] error session=${sessionId}`, evt);
        if (pingTimer) clearInterval(pingTimer);
        if (pongTimer) clearTimeout(pongTimer);
      },
    };
  });
}
