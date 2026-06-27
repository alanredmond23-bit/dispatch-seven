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
import { decomposeRoutes } from "./routes/decompose.js";
import { buildWsHandler } from "./routes/ws.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());

// Health check
app.get("/health", (c) =>
  c.json({ status: "ok", service: "d7-backend", ts: new Date().toISOString() })
);

// REST routes
app.route("/api/v1/agents", agentRoutes);
app.route("/api/v1/tasks", taskRoutes);
app.route("/api/v1/memory", memoryRoutes);
app.route("/api/v1/actions", actionRoutes);
app.route("/api/decompose", decomposeRoutes); // goal → DAG → dispatch7 tables

// WebSocket — must init before serve() so injectWebSocket can attach to the server
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
app.get("/ws", buildWsHandler(upgradeWebSocket));

const port = parseInt(process.env.PORT || "3001");
console.log(`D7 backend running on port ${port}`);

const server = serve({ fetch: app.fetch, port });
injectWebSocket(server);   // attach WS upgrade handler to the HTTP server
