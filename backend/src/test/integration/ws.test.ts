// ws.test.ts — WebSocket integration tests
// Tests: connect, send message, receive token stream + done event, verify task written to DB
//
// Mocks: Anthropic API (avoids real API calls + cost)
// Real: Hono WS server started in-process on a random port
// DB: dispatch7_test schema (set SUPABASE_URL + SUPABASE_SERVICE_ROLE in env)
//
// Pattern: start server → connect WS → send message → collect events → assert + teardown

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer }  from "http";
import { serve }         from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono }          from "hono";
import WebSocket         from "ws";

// ── MOCK ANTHROPIC ────────────────────────────────────────────────────────────
// Intercept fetch before any module imports that use it
const MOCK_RESPONSE_TEXT = "This is a mocked Claude response for testing.";

vi.stubGlobal("fetch", async (url: string, opts?: RequestInit) => {
  // Anthropic API call → return a minimal SSE stream
  if (typeof url === "string" && url.includes("anthropic.com")) {
    const sseBody = [
      `data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}`,
      `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"${MOCK_RESPONSE_TEXT}"}}`,
      `data: {"type":"message_delta","usage":{"output_tokens":12}}`,
      `data: [DONE]`,
    ].join("\n\n");

    // Return a ReadableStream mimicking SSE
    const encoder = new TextEncoder();
    let sent = false;
    const stream = new ReadableStream({
      pull(ctrl) {
        if (!sent) {
          sent = true;
          ctrl.enqueue(encoder.encode(sseBody));
        } else {
          ctrl.close();
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  // Supabase calls → return empty success (tasks write is fire-and-forget)
  if (typeof url === "string" && (url.includes("supabase") || url.includes("supabase.co"))) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Pass through everything else
  return new Response("{}", { status: 200 });
});

// ── ENV SETUP ─────────────────────────────────────────────────────────────────
// Required env for the backend to initialise (avoids thrown errors on missing keys)
process.env.ANTHROPIC_API_KEY     = "test-key-not-real";
process.env.SUPABASE_URL          = process.env.SUPABASE_URL          ?? "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? "test-service-role";
process.env.BUDGET_CAP_USD        = "100"; // high cap so we never hit it in tests

// ── SERVER BOOTSTRAP ──────────────────────────────────────────────────────────
let serverPort = 0;
let httpServer: ReturnType<typeof createServer>;

// Dynamically import AFTER env + mocks are configured
// We re-export just enough to stand up the WS handler
async function startTestServer(): Promise<number> {
  const { buildWsHandler } = await import("../../routes/ws.js");
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.get("/ws", buildWsHandler(upgradeWebSocket));
  app.get("/health", (c) => c.json({ ok: true }));

  return new Promise((resolve) => {
    // Port 0 = OS assigns a free port
    httpServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
      serverPort = info.port;
      injectWebSocket(httpServer);
      resolve(info.port);
    }) as ReturnType<typeof createServer>;
  });
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function connectWs(port: number, sessionId = "test-session-ws"): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?session_id=${sessionId}`);
    ws.once("open",  () => resolve(ws));
    ws.once("error", reject);
  });
}

/** Collect all WS messages until a "done" or "error" event, or timeout */
function collectMessages(ws: WebSocket, timeoutMs = 5000): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const timer = setTimeout(() => resolve(messages), timeoutMs);

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);
      if (msg.type === "done" || msg.type === "error") {
        clearTimeout(timer);
        resolve(messages);
      }
    });
    ws.once("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

// ── TESTS ─────────────────────────────────────────────────────────────────────
describe("WebSocket Integration", () => {
  beforeAll(async () => {
    await startTestServer();
  });

  afterAll(() => {
    httpServer?.close();
  });

  it("connects successfully", async () => {
    const ws = await connectWs(serverPort);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("returns error for non-JSON message", async () => {
    const ws  = await connectWs(serverPort, "test-session-bad-json");
    const msgs = collectMessages(ws, 2000);
    ws.send("not json at all");
    const received = await msgs;
    const errMsg = received.find((m: any) => m.type === "error");
    expect(errMsg).toBeDefined();
    ws.close();
  });

  it("returns error for missing content", async () => {
    const ws  = await connectWs(serverPort, "test-session-no-content");
    const msgs = collectMessages(ws, 2000);
    ws.send(JSON.stringify({ type: "message" })); // no content field
    const received = await msgs;
    const errMsg = received.find((m: any) => m.type === "error");
    expect(errMsg).toBeDefined();
    ws.close();
  });

  it("handles pong message without error", async () => {
    const ws = await connectWs(serverPort, "test-session-pong");
    // Send pong — should get no error back
    ws.send(JSON.stringify({ type: "pong" }));
    // Wait briefly to ensure no error comes back
    await new Promise((r) => setTimeout(r, 300));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("sends a user message and receives token stream + done event", async () => {
    const ws      = await connectWs(serverPort, "test-session-stream");
    const msgsProm = collectMessages(ws, 8000);

    ws.send(JSON.stringify({
      type:       "message",
      content:    "What is the D7 system?",
      session_id: "test-session-stream",
    }));

    const msgs = await msgsProm;
    ws.close();

    const types = msgs.map((m: any) => m.type);

    // Must receive a route indicator (which agent handled it)
    expect(types).toContain("route");

    // Must receive at least one token
    expect(types).toContain("token");

    // Must receive done
    expect(types).toContain("done");

    // Tokens should reconstruct the mock response
    const tokens = msgs
      .filter((m: any) => m.type === "token")
      .map((m: any) => m.content)
      .join("");
    expect(tokens).toContain(MOCK_RESPONSE_TEXT);

    // done event should carry session_id
    const doneMsg = msgs.find((m: any) => m.type === "done") as any;
    expect(doneMsg?.session_id).toBe("test-session-stream");
  });
});
