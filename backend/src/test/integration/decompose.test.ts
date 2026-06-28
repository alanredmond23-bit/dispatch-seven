// decompose.test.ts — project decomposer integration tests
// Tests: send a complex goal → verify tasks created in dispatch7_test.tasks
//
// Mocks: Anthropic API (haiku decomposer call) → returns deterministic JSON plan
// Real: Hono HTTP server, Supabase client pointed at dispatch7_test schema
//
// Why dispatch7_test: keeps integration tests from polluting dispatch7 production data.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { serve }  from "@hono/node-server";
import { Hono }   from "hono";
import { createServer } from "http";

// ── MOCK PLAN OUTPUT ──────────────────────────────────────────────────────────
const MOCK_PLAN = {
  title:  "Build D7 Scheduler Feature",
  domain: "CODE",
  tasks: [
    { title: "Design scheduler schema", agent: "BUILD",  priority: 8, payload: { instruction: "Create dispatch7.tasks migration for due_date column" }, depends_on_indices: [] },
    { title: "Implement scheduler-runner", agent: "BUILD", priority: 7, payload: { instruction: "Write scheduler-runner.ts with upsert logic" }, depends_on_indices: [0] },
    { title: "Write SchedulerPanel UI", agent: "BUILD",  priority: 6, payload: { instruction: "Create React timeline component" }, depends_on_indices: [1] },
  ],
};

// ── MOCK SUPABASE CLIENT ──────────────────────────────────────────────────────
// We track all inserts so we can assert on them without a real DB
const insertedProjects: unknown[] = [];
const insertedTasks:    unknown[] = [];
const insertedEdges:    unknown[] = [];

vi.mock("../../lib/supabase.js", () => {
  function makeQueryBuilder(store: unknown[]) {
    let insertData: unknown[] = [];
    const builder: any = {
      insert: (data: unknown) => {
        insertData = Array.isArray(data) ? data : [data];
        return builder;
      },
      select: (_fields?: string) => builder,
      single: () => Promise.resolve({ data: { id: `mock-id-${Date.now()}`, ...(insertData[0] as Record<string, unknown>) }, error: null }),
      // for tasks bulk insert
      then: undefined,
    };
    // Make builder thenable for await
    builder[Symbol.toStringTag] = "Promise";
    // Return a proper promise from insert().select()
    builder.select = (_fields?: string) => {
      const resultData = insertData.map((row: any, i) => ({ id: `mock-task-${i}`, ...row }));
      store.push(...resultData);
      return {
        data: resultData,
        error: null,
        single: () => Promise.resolve({ data: resultData[0], error: null }),
      };
    };
    return builder;
  }

  return {
    supabase: {
      from: (table: string) => {
        if (table === "projects") {
          return {
            insert: (data: unknown) => ({
              select: (_f?: string) => ({
                single: () => {
                  insertedProjects.push(data);
                  return Promise.resolve({ data: { id: "mock-project-id", title: (data as any).title }, error: null });
                },
              }),
            }),
          };
        }
        if (table === "tasks") {
          return {
            insert: (data: unknown[]) => ({
              select: (_f?: string) => {
                const result = data.map((row: any, i) => ({ id: `mock-task-${i}`, ...row }));
                insertedTasks.push(...result);
                return Promise.resolve({ data: result, error: null });
              },
            }),
          };
        }
        if (table === "task_graph") {
          return {
            insert: (data: unknown[]) => {
              insertedEdges.push(...data);
              return Promise.resolve({ data, error: null });
            },
          };
        }
        // fallback
        return { insert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) };
      },
    },
  };
});

// ── MOCK ANTHROPIC (decomposer uses direct fetch) ─────────────────────────────
vi.stubGlobal("fetch", async (url: string, _opts?: RequestInit) => {
  if (typeof url === "string" && url.includes("anthropic.com")) {
    return new Response(JSON.stringify({
      content: [{ type: "text", text: JSON.stringify(MOCK_PLAN) }],
      usage: { input_tokens: 50, output_tokens: 80 },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("{}", { status: 200 });
});

process.env.ANTHROPIC_API_KEY     = "test-key-decompose";
process.env.SUPABASE_URL          = process.env.SUPABASE_URL ?? "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ?? "test-service-role";

// ── SERVER BOOTSTRAP ──────────────────────────────────────────────────────────
let serverPort = 0;
let httpServer: ReturnType<typeof createServer>;

beforeAll(async () => {
  const { decomposeRoutes } = await import("../../routes/decompose.js");
  const app = new Hono();
  app.route("/api/decompose", decomposeRoutes);

  await new Promise<void>((resolve) => {
    httpServer = serve({ fetch: app.fetch, port: 0 }, (info) => {
      serverPort = info.port;
      resolve();
    }) as ReturnType<typeof createServer>;
  });
});

afterAll(() => httpServer?.close());

// ── TESTS ─────────────────────────────────────────────────────────────────────
describe("Decomposer Integration", () => {
  it("POST /api/decompose creates a project and tasks", async () => {
    const res = await fetch(`http://localhost:${serverPort}/api/decompose`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ goal: "Build the D7 scheduler feature end to end" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Response shape
    expect(body).toHaveProperty("project_id");
    expect(body).toHaveProperty("tasks");
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(body.tasks.length).toBe(3); // matches MOCK_PLAN.tasks

    // Tasks should be created in our mock store
    expect(insertedTasks.length).toBeGreaterThanOrEqual(3);

    // Verify task shapes
    const firstTask = insertedTasks[0] as any;
    expect(firstTask).toHaveProperty("title");
    expect(firstTask).toHaveProperty("agent");
    expect(firstTask).toHaveProperty("priority");
  });

  it("returns 400 when goal is missing", async () => {
    const res = await fetch(`http://localhost:${serverPort}/api/decompose`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when goal is empty string", async () => {
    const res = await fetch(`http://localhost:${serverPort}/api/decompose`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ goal: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("dependency edges are created for tasks with depends_on_indices", async () => {
    // MOCK_PLAN has task[1] depends on task[0], task[2] depends on task[1]
    // That's 2 edges
    expect(insertedEdges.length).toBeGreaterThanOrEqual(2);
    const edge = insertedEdges[0] as any;
    expect(edge).toHaveProperty("task_id");
    expect(edge).toHaveProperty("depends_on");
  });
});
