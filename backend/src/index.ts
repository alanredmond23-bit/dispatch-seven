// D7 Backend — Hono 4 TypeScript
// Deployed to Azure Container Apps (menagerie-rg)
// Secrets: menagerie-kv-37040 — never hardcode

import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { serve as inngestServe } from "inngest/hono";
import { agentRoutes } from "./routes/agents.js";
import taskRoutes from "./routes/tasks.js";
import { memoryRoutes } from "./routes/memory.js";
import { actionRoutes } from "./routes/actions.js";
// DISABLED: decompose.ts has broken agent import — TODO fix
// import { decomposeRoutes, v1DecomposeRoutes } from "./routes/decompose.js";
import { buildWsHandler } from "./routes/ws.js";
import { runsRoutes } from "./routes/runs.js";
import { copilotRoutes } from "./routes/copilot.js";   // S3: CopilotKit runtime
import { settingsRouter } from "./routes/settings.js"; // Settings: system prompt + model + feature flags
import { jobRoutes } from "./routes/jobs.js";          // T9: Inngest job queue API
import { sessionRoutes } from "./routes/sessions.js";  // T10: active session listing
import { budgetGuard } from "./middleware/budget-guard.js"; // PR32: per-session spend cap
import { evidenceRoutes } from "./routes/evidence.js"; // Five9 WAV evidence indexer — 5:24-cr-00376
import { flushLangfuse } from "./lib/langfuse.js";     // P1-3: graceful shutdown flush

// Inngest — client + all registered functions
import { inngest } from "./lib/inngest.js";
import { researchJob } from "./inngest/researchJob.js";
import { summaryJob } from "./inngest/summaryJob.js";
import { deadlineSweep } from "./inngest/deadlineSweep.js";
import { inngestFunctions } from "./inngest/functions.js";

// ── P1-1: Simple in-memory rate limiter ──────────────────────────────────────
// 60 req/min per IP for HTTP routes, 10 WS upgrades/min per IP.
// Uses a sliding window with per-IP counters that auto-expire after 60s.
// Set RATE_LIMIT_DISABLED=true to bypass (local dev).
const RATE_LIMIT_DISABLED = process.env.RATE_LIMIT_DISABLED === "true";
const HTTP_LIMIT_PER_MIN  = 60;
const WS_LIMIT_PER_MIN    = 10;

interface RateEntry { count: number; resetAt: number }
const httpRateMap = new Map<string, RateEntry>();
const wsRateMap   = new Map<string, RateEntry>();

function checkRateLimit(map: Map<string, RateEntry>, ip: string, limit: number): boolean {
  if (RATE_LIMIT_DISABLED) return true;
  const now = Date.now();
  let entry = map.get(ip);
  if (!entry || now >= entry.resetAt) {
    // New window
    entry = { count: 1, resetAt: now + 60_000 };
    map.set(ip, entry);
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}

// Periodically purge expired entries to avoid unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of httpRateMap) if (now >= entry.resetAt) httpRateMap.delete(ip);
  for (const [ip, entry] of wsRateMap)   if (now >= entry.resetAt) wsRateMap.delete(ip);
}, 120_000);

const app = new Hono();

// Middleware
app.use("*", logger());

// P0-5: Configurable CORS — no more wildcard allow-all.
// Set CORS_ORIGINS env var as a comma-separated list of allowed origins.
// Default allows localhost dev only. Production ACA env should set:
//   CORS_ORIGINS=https://alanredmond23-bit.github.io
// (add additional origins as comma-separated values if needed)
app.use("*", cors({
  origin: (origin) => {
    const allowed = (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",").map(s => s.trim());
    return allowed.includes(origin ?? "") ? origin : allowed[0];
  },
}));

// P1-1: HTTP rate limiting — 60 req/min per IP
app.use("*", async (c, next) => {
  if (!RATE_LIMIT_DISABLED) {
    // Extract client IP — prefer X-Forwarded-For (set by ACA / Azure Front Door)
    const ip = c.req.header("X-Forwarded-For")?.split(",")[0].trim()
             ?? c.req.header("X-Real-IP")
             ?? "unknown";
    if (!checkRateLimit(httpRateMap, ip, HTTP_LIMIT_PER_MIN)) {
      return c.json({ error: "Too Many Requests" }, 429);
    }
  }
  return next();
});

app.use("/api/*", budgetGuard); // PR32: 402 when session exceeds budget_usd

// Health check
app.get("/health", (c) =>
  c.json({ status: "ok", version: "1.0.0", timestamp: Date.now() })
);

// REST routes
app.route("/api/v1/agents", agentRoutes);
app.route("/api/v1/tasks", taskRoutes);
app.route("/api/v1/memory", memoryRoutes);
app.route("/api/v1/actions", actionRoutes);
// app.route("/api/decompose", decomposeRoutes);  // disabled: broken import
// app.route("/api/v1/decompose", v1DecomposeRoutes);  // disabled: broken import
app.route("/api/v1/runs", runsRoutes);             // cost dashboard + usage tracking + task-graph
app.route("/api/copilot", copilotRoutes);          // S3: CopilotKit action runtime
app.route("/api/v1/jobs", jobRoutes);              // T9: job trigger + status
app.route("/api/v1/sessions", sessionRoutes);      // T10: session list + message feed
app.route("/api/evidence", evidenceRoutes);        // Five9 WAV evidence — ingest/search/list — 5:24-cr-00376
app.route("/api/settings", settingsRouter);        // Settings: CRUD for all D7 operator preferences

// Inngest serve handler — canonical Hono adapter pattern
// GET: introspection by Inngest Cloud
// PUT: function registration sync
// POST: event delivery
// signingKey validates requests from Inngest Cloud (set INNGEST_SIGNING_KEY in env)
app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  inngestServe({
    client: inngest,
    functions: [
      researchJob,
      summaryJob,
      deadlineSweep,
      ...inngestFunctions,  // agentTrigger, webhookProcessor, scheduledSweep, five9IndexJob, voyageBackfillJob
    ],
    signingKey: process.env.INNGEST_SIGNING_KEY,
  })
);

// WebSocket — must init before serve() so injectWebSocket can attach to the server
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// P1-1: WS upgrade rate limit — 10 upgrades/min per IP before handing off to handler
app.get("/ws", async (c, next) => {
  if (!RATE_LIMIT_DISABLED) {
    const ip = c.req.header("X-Forwarded-For")?.split(",")[0].trim()
             ?? c.req.header("X-Real-IP")
             ?? "unknown";
    if (!checkRateLimit(wsRateMap, ip, WS_LIMIT_PER_MIN)) {
      return c.json({ error: "Too Many Requests" }, 429);
    }
  }
  return next();
}, buildWsHandler(upgradeWebSocket));

const port = parseInt(process.env.PORT || "3001");
console.log(`D7 backend running on port ${port}`);

const server = serve({ fetch: app.fetch, port });
injectWebSocket(server);   // attach WS upgrade handler to the HTTP server

// P1-3: SIGTERM handler — flush Langfuse before container shutdown.
// Azure Container Apps sends SIGTERM before killing the process.
// Without this, buffered Langfuse events are lost on every deploy/scale-in.
process.on("SIGTERM", async () => {
  console.log("[shutdown] SIGTERM received, flushing Langfuse...");
  try { await flushLangfuse(); } catch (err) {
    console.error("[shutdown] Langfuse flush error:", err);
  }
  process.exit(0);
});
