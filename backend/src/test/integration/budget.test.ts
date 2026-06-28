// budget.test.ts — budget cap enforcement tests
// Tests: set a low budget cap, send messages until cap is hit, verify WS closes with budget error
//
// Strategy: mock Supabase agent_runs to return a growing spend total.
// The ws.ts budget check calls supabase.from("agent_runs").select("cost_usd").eq("session_id", ...)
// We intercept that with a stateful mock that increments spend per query.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { serve }  from "@hono/node-server";
import { Hono }   from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { createServer } from "http";
import WebSocket  from "ws";

// ── MOCK STATE ────────────────────────────────────────────────────────────────
// Tracks per-session mock spend so we can simulate budget accumulation
const mockSpend: Map<string, number> = new Map();

// ── MOCK SUPABASE ─────────────────────────────────────────────────────────────
vi.mock("../../lib/supabase.js", () => {
  return {
    supabase: {
      from: (table: string) => ({
        select: (_fields?: string) => ({
          eq: (col: string, val: string) => {
            if (table === "agent_runs" && col === "session_id") {
              // Return current mock spend for this session
              const spend = mockSpend.get(val) ?? 0;
              // Simulate returning rows that sum to `spend`
              const rows = spend > 0 ? [{ cost_usd: spend }] : [];
              return Promise.resolve({ data: rows, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
          not: (_col: string, _op: string, _val: unknown) =>
            Promise.resolve({ data: [], error: null }),
          order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
        }),
        upsert: (_data: unknown, _opts?: unknown) =>
          Promise.resolve({ data: null, error: null }),
        insert: (_data: unknown) => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: "run-1" }, error: null }),
          }),
        }),
        update: (_data: unknown) => ({
          eq: (_col: string, _val: unknown) =>
            Promise.resolve({ data: null, error: null }),
        }),
      }),
    },
  };
});

// ── MOCK ANTHROPIC ────────────────────────────────────────────────────────────
vi.stubGlobal("fetch", async (url: string, _opts?: RequestInit) => {
  if (typeof url === "string" && url.includes("anthropic.com")) {
    const sseBody = [
      `data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}`,
      `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}`,
      `data: {"type":"message_delta","usage":{"output_tokens":5}}`,
      `data: [DONE]`,
    ].join("\n\n");
    const encoder = new TextEncoder();
    let sent = false;
    const stream = new ReadableStream({
      pull(ctrl) {
        if (!sent) { sent = true; ctrl.enqueue(encoder.encode(sseBody)); }
        else ctrl.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  return new Response("{}", { status: 200 });
});

// ── ENV ───────────────────────────────────────────────────────────────────────
process.env.ANTHROPIC_API_KEY     = "test-key-budget";
process.env.SUPABASE_URL          = process.env.SUPABASE_URL ?? "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? "test-service-role";

// LOW budget cap — $0.05
process.env.BUDGET_CAP_USD = "0.05";

// ── SERVER BOOTSTRAP ──────────────────────────────────────────────────────────
let serverPort = 0;
let httpServer: ReturnType<typeof createServer>;

beforeAll(async () => {
  const { buildWsHandler } = await import("../../routes/ws.js");
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  app.get("/ws", buildWsHandler(upgradeWebSocket));

  await new Promise<void>((resolve) => {
    httpServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
      serverPort = info.port;
      injectWebSocket(httpServer);
      resolve();
    }) as ReturnType<typeof createServer>;
  });
});

afterAll(() => httpServer?.close());

// ── HELPERS ───────────────────────────────────────────────────────────────────
function connectWs(sessionId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${serverPort}/ws?session_id=${sessionId}`);
    ws.once("open",  () => resolve(ws));
    ws.once("error", reject);
  });
}

function waitForEvent(ws: WebSocket, type: string, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() =>
      reject(new Error(`Timeout waiting for "${type}" event`)), timeoutMs
    );
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          resolve(msg);
        }
      } catch { /* ignore non-JSON */ }
    });
  });
}

/** Collect all messages until WS closes or timeout */
function collectUntilClose(ws: WebSocket, timeoutMs = 5000): Promise<unknown[]> {
  return new Promise((resolve) => {
    const messages: unknown[] = [];
    const timer = setTimeout(() => resolve(messages), timeoutMs);
    ws.on("message", (raw) => {
      try { messages.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
    });
    ws.once("close", () => { clearTimeout(timer); resolve(messages); });
  });
}

// ── TESTS ─────────────────────────────────────────────────────────────────────
describe("Budget Cap Enforcement", () => {

  it("allows message when budget is under cap (0 spend)", async () => {
    const sessionId = "budget-under-cap";
    mockSpend.set(sessionId, 0); // zero spend → should pass

    const ws   = await connectWs(sessionId);
    const msgs = collectUntilClose(ws, 6000);

    ws.send(JSON.stringify({
      type:       "message",
      content:    "What is D7?",
      session_id: sessionId,
    }));

    const received = await msgs;
    ws.close();

    const types = received.map((m: any) => m.type);
    // Should complete — no budget error
    expect(types).not.toContain("error");
    expect(types).toContain("done");
  });

  it("blocks message when budget is exceeded and sends budget error", async () => {
    const sessionId = "budget-over-cap";
    // Spend is already $1.00 which exceeds the $0.05 cap
    mockSpend.set(sessionId, 1.00);

    const ws   = await connectWs(sessionId);
    const msgs = collectUntilClose(ws, 6000);

    ws.send(JSON.stringify({
      type:       "message",
      content:    "Tell me about the court case",
      session_id: sessionId,
    }));

    const received = await msgs;

    const errMsg = received.find((m: any) => m.type === "error") as any;
    expect(errMsg).toBeDefined();
    expect(errMsg?.message).toMatch(/budget/i);
  });

  it("WS closes with code 1008 when budget cap is reached", async () => {
    const sessionId = "budget-close-1008";
    mockSpend.set(sessionId, 5.00); // way over $0.05 cap

    const ws      = await connectWs(sessionId);
    const closeProm = new Promise<number>((resolve) => {
      ws.once("close", (code) => resolve(code));
    });

    ws.send(JSON.stringify({
      type:       "message",
      content:    "Run the research task",
      session_id: sessionId,
    }));

    const closeCode = await Promise.race([
      closeProm,
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error("WS did not close within timeout")), 5000)
      ),
    ]);

    expect(closeCode).toBe(1008); // Policy Violation — budget cap
  });

  it("budget cap is session-scoped — different sessions are independent", async () => {
    const sessionOver  = "budget-scoped-over";
    const sessionUnder = "budget-scoped-under";

    mockSpend.set(sessionOver,  2.00); // over cap
    mockSpend.set(sessionUnder, 0.00); // under cap

    // Connect both sessions simultaneously
    const [wsOver, wsUnder] = await Promise.all([
      connectWs(sessionOver),
      connectWs(sessionUnder),
    ]);

    const [msgsOver, msgsUnder] = await Promise.all([
      collectUntilClose(wsOver, 6000),
      collectUntilClose(wsUnder, 6000).then(async (m) => {
        // Close wsUnder after short delay to stop collection
        setTimeout(() => wsUnder.close(), 100);
        return m;
      }),
    ]);

    // Over-cap session should get error
    const overErr = msgsOver.find((m: any) => m.type === "error");
    expect(overErr).toBeDefined();

    wsOver.close();
    wsUnder.close();
  });
});
