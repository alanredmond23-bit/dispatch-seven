// routes/health.ts — deep dependency health check
// GET /health — replaces static { status: "ok" } with real probes
//
// Response shape:
// {
//   status: "healthy" | "degraded" | "down",
//   version: string,
//   uptime_ms: number,
//   timestamp: string,
//   dependencies: {
//     supabase:   { status, latency_ms, detail? }
//     anthropic:  { status, detail? }
//     inngest:    { status, detail? }
//     mem0:       { status, detail? }
//     voyage:     { status, detail? }
//   }
// }
//
// "healthy"  — all critical deps (supabase, anthropic) pass
// "degraded" — one or more optional deps fail but critical pass
// "down"     — any critical dep fails
//
// Critical:  supabase, anthropic key present
// Optional:  inngest signing key, mem0 api key, voyage api key

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";

export const healthRoutes = new Hono();

const START_TIME = Date.now();

interface DepResult {
  status: "ok" | "degraded" | "down";
  latency_ms?: number;
  detail?: string;
}

// ── Individual probes ──────────────────────────────────────────────────────

/** Supabase: execute a lightweight count query (no full table scan) */
async function probeSupabase(): Promise<DepResult> {
  const t0 = Date.now();
  try {
    const { error } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .limit(1);

    const latency_ms = Date.now() - t0;
    if (error) {
      return { status: "down", latency_ms, detail: error.message };
    }
    return { status: "ok", latency_ms };
  } catch (err: unknown) {
    return {
      status: "down",
      latency_ms: Date.now() - t0,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Anthropic: key present + format valid (no API call — avoids cost) */
function probeAnthropic(): DepResult {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { status: "down", detail: "ANTHROPIC_API_KEY not set" };
  }
  // Anthropic keys are "sk-ant-api03-..." (at least 40 chars)
  if (!key.startsWith("sk-ant-") || key.length < 40) {
    return { status: "degraded", detail: "ANTHROPIC_API_KEY set but format looks wrong" };
  }
  return { status: "ok" };
}

/** Inngest: signing key present (env only — no HTTP probe to avoid latency) */
function probeInngest(): DepResult {
  const key = process.env.INNGEST_SIGNING_KEY;
  if (!key) {
    return { status: "degraded", detail: "INNGEST_SIGNING_KEY not set — event delivery unverified" };
  }
  return { status: "ok" };
}

/** Mem0: API key present */
function probeMem0(): DepResult {
  const key = process.env.MEM0_API_KEY;
  if (!key) {
    return { status: "degraded", detail: "MEM0_API_KEY not set — memory context disabled" };
  }
  return { status: "ok" };
}

/** Voyage: API key present */
function probeVoyage(): DepResult {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) {
    return { status: "degraded", detail: "VOYAGE_API_KEY not set — semantic search disabled" };
  }
  return { status: "ok" };
}

// ── Health route ───────────────────────────────────────────────────────────

healthRoutes.get("/", async (c) => {
  // Run all probes in parallel (Supabase is async, rest are sync)
  const [supabaseResult] = await Promise.all([probeSupabase()]);

  const dependencies = {
    supabase:  supabaseResult,
    anthropic: probeAnthropic(),
    inngest:   probeInngest(),
    mem0:      probeMem0(),
    voyage:    probeVoyage(),
  };

  // Critical deps: supabase + anthropic
  const criticalDown =
    dependencies.supabase.status === "down" ||
    dependencies.anthropic.status === "down";

  // Optional deps: inngest, mem0, voyage
  const anyDegraded = Object.values(dependencies).some(
    (d) => d.status !== "ok"
  );

  const overallStatus = criticalDown
    ? "down"
    : anyDegraded
    ? "degraded"
    : "healthy";

  const httpStatus = criticalDown ? 503 : 200;

  return c.json(
    {
      status: overallStatus,
      version: process.env.npm_package_version ?? "1.0.0",
      uptime_ms: Date.now() - START_TIME,
      timestamp: new Date().toISOString(),
      dependencies,
    },
    httpStatus
  );
});

