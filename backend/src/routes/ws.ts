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

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS  = 5_000;

// Stream Claude tokens, calling onToken per chunk, returns full text
async function streamClaude(
  content: string,
  onToken: (tok: string) => void
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "x-api-key":       apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:       "claude-sonnet-4-6",
      max_tokens:  1200,
      stream:      true,
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }

  // Parse SSE stream from Anthropic
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop() ?? "";           // keep incomplete last line

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;
      try {
        const evt = JSON.parse(data);
        if (
          evt.type === "content_block_delta" &&
          evt.delta?.type === "text_delta"
        ) {
          onToken(evt.delta.text);
        }
      } catch {
        // malformed JSON line — skip
      }
    }
  }
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
        console.log(`[WS] message session=${sid} len=${msg.content.length}`);

        try {
          await streamClaude(msg.content, (token) => {
            ws.send(JSON.stringify({ type: "token", content: token }));
          });
          ws.send(JSON.stringify({ type: "done", session_id: sid }));
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
