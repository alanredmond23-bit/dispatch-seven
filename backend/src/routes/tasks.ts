// Task queue routes
// GET  /api/v1/tasks           — list tasks (filter by status, agent, priority)
// POST /api/v1/tasks           — create task
// PATCH /api/v1/tasks/:id      — update status/assignee

import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";

export const taskRoutes = new Hono();

taskRoutes.get("/", async (c) => {
  const status = c.req.query("status");
  const agent = c.req.query("agent");
  let q = supabase.from("tasks").select("*").order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  if (agent) q = q.eq("assignee", agent);
  const { data, error } = await q.limit(100);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ tasks: data, count: data?.length ?? 0 });
});

taskRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title: body.title,
      body: body.body ?? null,
      assignee: body.assignee ?? "ORCHESTRATOR",
      priority: body.priority ?? "p1",
      status: "open",
      domain: body.domain ?? "DEVOPS",
    })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

taskRoutes.patch("/:id", async (c) => {
  const body = await c.req.json();
  const { data, error } = await supabase
    .from("tasks")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});
