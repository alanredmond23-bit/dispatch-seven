// D7 Backend — Hono 4 TypeScript
// Deployed to Azure Container Apps (menagerie-rg)
// Secrets: menagerie-kv-37040 — never hardcode

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { agentRoutes } from "./routes/agents.js";
import { taskRoutes } from "./routes/tasks.js";
import { memoryRoutes } from "./routes/memory.js";
import { decomposeRoutes } from "./routes/decompose.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok", service: "d7-backend", ts: new Date().toISOString() }));

// Routes
app.route("/api/v1/agents", agentRoutes);
app.route("/api/v1/tasks", taskRoutes);
app.route("/api/v1/memory", memoryRoutes);
app.route("/api/decompose", decomposeRoutes); // goal → DAG → dispatch7 tables

const port = parseInt(process.env.PORT || "3001");
console.log(`D7 backend running on port ${port}`);

serve({ fetch: app.fetch, port });
