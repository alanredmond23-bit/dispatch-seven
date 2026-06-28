// D7 Backend — Hono 4 TypeScript
// Deployed to Azure Container Apps (menagerie-rg)
// Secrets: menagerie-kv-37040 — never hardcode

import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { agentRoutes } from "./routes/agents.js";
import { taskRoutes } from "./routes/tasks.js";
import { memoryRoutes } from "./routes/memory.js";
import { actionRoutes } from "./routes/actions.js";
import { decomposeRoutes, v1DecomposeRoutes } from "./routes/decompose.js";
import { buildWsHandler } from "./routes/ws.js";
import { runsRoutes } from "./routes/runs.js";
import { inngestRoutes } from "./routes/inngest.js";   // S3: Inngest event endpoint
import { copilotRoutes } from "./routes/copilot.js";   // S3: CopilotKit runtime
import { jobRoutes } from "./routes/jobs.js";          // T9: Inngest job queue API
import { sessionRoutes } from "./routes/sessions.js";  // T10: active session listing
import { budgetGuard } from "./middleware/budget-guard.js"; // PR32: per-session spend cap

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());
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
app.route("/api/decompose", decomposeRoutes);      // original project DAG decomposer
app.route("/api/v1/decompose", v1DecomposeRoutes); // T4: session-scoped Haiku pre-planner
app.route("/api/v1/runs", runsRoutes);             // cost dashboard + usage tracking + task-graph
app.route("/api/inngest", inngestRoutes);           // S3: Inngest webhook (event delivery)
app.route("/api/copilot", copilotRoutes);           // S3: CopilotKit action runtime
app.route("/api/v1/jobs", jobRoutes);                  // T9: job trigger + status
app.route("/api/v1/sessions", sessionRoutes);          // T10: session list + message feed

// WebSocket — must init before serve() so injectWebSocket can attach to the server
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
app.get("/ws", buildWsHandler(upgradeWebSocket));

const port = parseInt(process.env.PORT || "3001");
console.log(`D7 backend running on port ${port}`);

const server = serve({ fetch: app.fetch, port });
injectWebSocket(server);   // attach WS upgrade handler to the HTTP server
