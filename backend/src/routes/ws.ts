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

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS  = 5_000;

// Stream Claude tokens, calling onToken per chunk.
// Returns { input_tokens, output_tokens } captured from SSE message_start / message_delta events.
// systemPrompt: prepended context (memory injection, etc.)
async function streamClaude(
  content: string,
  onToken: (tok: string) => void,
  systemPrompt?: string
): Promise<{ input_tokens: number; output_tokens: number; fullResponse: string }> {
  const usage = { input_tokens: 0, output_tokens: 0 };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const body: Record<string, unknown> = {
    model:       "claude-sonnet-4-6",
    max_tokens:  1200,
    stream:      true,
    messages: [{ role: "user", content }],
  };
  if (systemPrompt) body.system = systemPrompt;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "x-api-key":       apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }

  // Parse SSE stream from Anthropic
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let fullResponse = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop() ?? "";           // keep incomplete last line

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return { ...usage, fullResponse };
      try {
        const evt = JSON.parse(data);
        if (evt.type === "message_start" && evt.message?.usage) {
          // input_tokens arrive in message_start
          usage.input_tokens = evt.message.usage.input_tokens ?? 0;
        } else if (evt.type === "message_delta" && evt.usage) {
          // output_tokens arrive in message_delta
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

// Factory: call with the upgradeWebSocket helper from @hono/node-ws
export function buildWsHandler(upgradeWebSocket: UpgradeWebSocket) {
  return upgradeWebSocket((c) => {
    const sessionId = c.req.query("session_id") ?? "unknown";
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let pongTimer: ReturnType<typeof setTimeout>  | null = null;

    return {
      onOpen(_evt, ws) {
        console.log(`[WS] open session=${sessionId}`);

        // Heartbeat: ping every 30s, expect pong within 5s
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

        let msg: { type: string; content?: string; session_id?: string };
        try {
          msg = JSON.parse(raw);
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
          return;
        }

        // Pong clears the pong timeout
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
        console.log(`[WS] message session=${sid} len=${userMessage.length}`);

        // --- Mem0: fetch relevant context from prior sessions ---
        let systemPrompt: string | undefined;
        try {
          const memCtx = await getRelevantContext(sid, userMessage);
          if (memCtx) {
            systemPrompt =
              `You have access to these memories from prior sessions:\n${memCtx}\n\n---\n`;
          }
        } catch {
          // Mem0 down — proceed without context
        }

        // Cost tracking: start row before Claude call, finish after with usage
        const tracker = trackRun({ session_id: sid, agent: "SCHEDULER", model: "claude-sonnet-4-6" });
        const runId = await tracker.start().catch(() => null); // non-fatal if Supabase is unavailable

        try {
          const { fullResponse, ...usage } = await streamClaude(
            userMessage,
            (token) => { ws.send(JSON.stringify({ type: "token", content: token })); },
            systemPrompt
          );

          ws.send(JSON.stringify({ type: "done", session_id: sid }));

          // Record usage — fire-and-forget so WS response isn't delayed
          if (runId) tracker.finish(runId, usage).catch(console.error);

          // --- Mem0: store conversation turn after response ---
          addMemory(sid, [
            { role: "user",      content: userMessage   },
            { role: "assistant", content: fullResponse  },
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
