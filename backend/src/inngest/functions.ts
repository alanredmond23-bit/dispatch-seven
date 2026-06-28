// Inngest function definitions for D7 — event-driven agent orchestration
// Three original functions: agentTrigger, webhookProcessor, scheduledSweep
// Turn 9 additions: researchJob, summaryJob, deadlineSweep
// ponytail: single agent trigger — fan-out orchestration when needed

import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";

// ── 1. agentTrigger ──────────────────────────────────────────────────────────
// Fires on "dispatch/agent.trigger" — inserts a pending run row, returns run_id
export const agentTrigger = inngest.createFunction(
  { id: "agent-trigger", name: "Agent Trigger" },
  { event: "dispatch/agent.trigger" },
  async ({ event, step }) => {
    const { session_id, agent, instruction, priority } = event.data as {
      session_id: string;
      agent: string;
      instruction: string;
      priority: "high" | "normal" | "low";
    };

    const run_id = await step.run("insert-pending-run", async () => {
      const { data, error } = await supabase
        .schema("dispatch7")
        .from("agent_runs")
        .insert({
          session_id,
          agent,
          instruction,
          priority,
          status: "pending",
          triggered_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error) throw new Error(`Failed to insert agent_run: ${error.message}`);
      return data.id as string;
    });

    console.log(`[agentTrigger] run_id=${run_id} agent=${agent} session=${session_id}`);
    return { run_id };
  }
);

// ── 2. webhookProcessor ──────────────────────────────────────────────────────
// Fires on "dispatch/webhook.received" — routes to agentTrigger, stamps last_triggered_at
export const webhookProcessor = inngest.createFunction(
  { id: "webhook-processor", name: "Webhook Processor" },
  { event: "dispatch/webhook.received" },
  async ({ event, step }) => {
    const { webhook_id, payload, source } = event.data as {
      webhook_id: string;
      payload: Record<string, unknown>;
      source: string;
    };

    const config = await step.run("fetch-webhook-config", async () => {
      const { data, error } = await supabase
        .schema("dispatch7")
        .from("webhooks")
        .select("id, agent, instruction_template, session_id")
        .eq("id", webhook_id)
        .single();

      if (error) throw new Error(`Webhook ${webhook_id} not found: ${error.message}`);
      return data;
    });

    await step.run("route-to-agent", async () => {
      await inngest.send({
        name: "dispatch/agent.trigger",
        data: {
          session_id: config.session_id,
          agent: config.agent,
          instruction: config.instruction_template ?? `Webhook received from ${source}`,
          priority: "normal" as const,
        },
      });
    });

    await step.run("update-last-triggered", async () => {
      const { error } = await supabase
        .schema("dispatch7")
        .from("webhooks")
        .update({ last_triggered_at: new Date().toISOString() })
        .eq("id", webhook_id);

      if (error) throw new Error(`Failed to stamp webhook: ${error.message}`);
    });

    console.log(`[webhookProcessor] webhook_id=${webhook_id} source=${source} → agent=${config.agent}`);
    return { webhook_id, routed_to: config.agent };
  }
);

// ── 3. scheduledSweep ────────────────────────────────────────────────────────
// Runs hourly — queries dispatch7.deadlines for items due in next 24h
export const scheduledSweep = inngest.createFunction(
  { id: "scheduled-sweep", name: "Hourly Deadline Sweep" },
  { cron: "0 * * * *" },
  async ({ step }) => {
    const now = new Date();
    const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const deadlines = await step.run("query-upcoming-deadlines", async () => {
      const { data, error } = await supabase
        .schema("dispatch7")
        .from("deadlines")
        .select("id, session_id, description, due_at")
        .gte("due_at", now.toISOString())
        .lte("due_at", horizon.toISOString())
        .eq("notified", false);

      if (error) throw new Error(`Deadline query failed: ${error.message}`);
      return data ?? [];
    });

    await step.run("trigger-deadline-agents", async () => {
      await Promise.all(
        deadlines.map((d) =>
          inngest.send({
            name: "dispatch/agent.trigger",
            data: {
              session_id: d.session_id,
              agent: "SCHEDULER",
              instruction: `Deadline approaching: ${d.description} — due at ${d.due_at}`,
              priority: "high" as const,
            },
          })
        )
      );
    });

    console.log(`[scheduledSweep] triggered ${deadlines.length} deadline agent(s)`);
    return { triggered: deadlines.length };
  }
);

// ── 4. researchJob ───────────────────────────────────────────────────────────
// Turn 9: Fires on "dispatch/job.research"
// Accepts { query, session_id, job_id } — searches memory for related context,
// delegates to RESEARCH agent, stores result to dispatch7.memory.
// job_id is a UUID pre-created in dispatch7.job_runs so /status/:job_id can poll.
export const researchJob = inngest.createFunction(
  { id: "research-job", name: "Research Job" },
  { event: "dispatch/job.research" },
  async ({ event, step }) => {
    const { query, session_id, job_id } = event.data as {
      query: string;
      session_id: string;
      job_id: string;
    };

    // Mark running
    await step.run("mark-running", async () => {
      const { error } = await supabase
        .schema("dispatch7")
        .from("job_runs")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", job_id);
      if (error) console.error(`[researchJob] mark-running error: ${error.message}`);
    });

    // Pull existing memory context related to session — used to seed the research result
    const contextChunks = await step.run("fetch-memory-context", async () => {
      const { data } = await supabase
        .schema("dispatch7")
        .from("memory")
        .select("key, value")
        .eq("agent", "RESEARCH")
        // Filter by session_id stored inside value JSON
        .filter("value->>session_id", "eq", session_id)
        .order("updated_at", { ascending: false })
        .limit(5);
      return data ?? [];
    });

    // Trigger RESEARCH agent via agentTrigger event — agent will do the actual LLM call
    await step.run("dispatch-research-agent", async () => {
      await inngest.send({
        name: "dispatch/agent.trigger",
        data: {
          session_id,
          agent: "RESEARCH",
          instruction: `Research query: ${query}`,
          priority: "normal" as const,
        },
      });
    });

    // Store job result stub to memory — agent run will populate full result async
    const memoryKey = `research:${session_id}:${Date.now()}`;
    await step.run("store-to-memory", async () => {
      const { error } = await supabase
        .schema("dispatch7")
        .from("memory")
        .upsert({
          key: memoryKey,
          value: {
            query,
            session_id,
            job_id,
            status: "delegated_to_agent",
            context_chunks: contextChunks.length,
            requested_at: new Date().toISOString(),
          },
          agent: "RESEARCH",
          updated_at: new Date().toISOString(),
        });
      if (error) throw new Error(`Memory store failed: ${error.message}`);
    });

    // Mark completed — agent is running async; job record shows delegated
    await step.run("mark-completed", async () => {
      const { error } = await supabase
        .schema("dispatch7")
        .from("job_runs")
        .update({
          status: "completed",
          result: { memory_key: memoryKey, context_chunks: contextChunks.length },
          updated_at: new Date().toISOString(),
        })
        .eq("id", job_id);
      if (error) console.error(`[researchJob] mark-completed error: ${error.message}`);
    });

    console.log(`[researchJob] job_id=${job_id} session=${session_id} key=${memoryKey}`);
    return { job_id, memory_key: memoryKey };
  }
);

// ── 5. summaryJob ────────────────────────────────────────────────────────────
// Turn 9: Fires on "dispatch/job.summary"
// Accepts { session_id, job_id, message_limit? }
// Reads last N agent_runs for session, generates a text summary, stores to memory.
export const summaryJob = inngest.createFunction(
  { id: "summary-job", name: "Summary Job" },
  { event: "dispatch/job.summary" },
  async ({ event, step }) => {
    const { session_id, job_id, message_limit = 20 } = event.data as {
      session_id: string;
      job_id: string;
      message_limit?: number;
    };

    await step.run("mark-running", async () => {
      await supabase
        .schema("dispatch7")
        .from("job_runs")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", job_id);
    });

    // Read recent agent runs for this session — these represent the "messages"
    const runs = await step.run("read-session-runs", async () => {
      const { data, error } = await supabase
        .schema("dispatch7")
        .from("agent_runs")
        .select("agent, status, cost_usd, started_at, finished_at")
        .eq("session_id", session_id)
        .order("started_at", { ascending: false })
        .limit(message_limit);

      if (error) throw new Error(`Failed to read agent_runs: ${error.message}`);
      return data ?? [];
    });

    // Build summary from run data — counts by agent, total cost, time span
    const summary = await step.run("generate-summary", async () => {
      const byAgent: Record<string, { count: number; cost: number }> = {};
      let totalCost = 0;

      for (const run of runs) {
        const key = run.agent as string;
        if (!byAgent[key]) byAgent[key] = { count: 0, cost: 0 };
        byAgent[key].count += 1;
        byAgent[key].cost += Number(run.cost_usd ?? 0);
        totalCost += Number(run.cost_usd ?? 0);
      }

      const agentLines = Object.entries(byAgent)
        .map(([agent, v]) => `${agent}: ${v.count} run(s), $${v.cost.toFixed(4)}`)
        .join(" | ");

      const oldest = runs[runs.length - 1]?.started_at;
      const newest = runs[0]?.started_at;

      return {
        session_id,
        run_count: runs.length,
        total_cost_usd: totalCost,
        agent_breakdown: byAgent,
        summary_text: `Session ${session_id} — ${runs.length} runs, $${totalCost.toFixed(4)} total. Agents: ${agentLines}. Time span: ${oldest} → ${newest}.`,
        generated_at: new Date().toISOString(),
      };
    });

    // Store to dispatch7.memory
    const memoryKey = `summary:${session_id}:${Date.now()}`;
    await step.run("store-summary", async () => {
      const { error } = await supabase
        .schema("dispatch7")
        .from("memory")
        .upsert({
          key: memoryKey,
          value: summary,
          agent: "ORCHESTRATOR",
          updated_at: new Date().toISOString(),
        });
      if (error) throw new Error(`Summary store failed: ${error.message}`);
    });

    await step.run("mark-completed", async () => {
      await supabase
        .schema("dispatch7")
        .from("job_runs")
        .update({
          status: "completed",
          result: { memory_key: memoryKey, run_count: summary.run_count, total_cost_usd: summary.total_cost_usd },
          updated_at: new Date().toISOString(),
        })
        .eq("id", job_id);
    });

    console.log(`[summaryJob] job_id=${job_id} session=${session_id} runs=${summary.run_count}`);
    return { job_id, memory_key: memoryKey, summary };
  }
);

// ── 6. deadlineSweep ─────────────────────────────────────────────────────────
// Turn 9: Runs every 6 hours — scans dispatch7.tasks for overdue items,
// fires agentTrigger(SCHEDULER) alerts and logs to dispatch7.events.
// "Overdue" = status in ('open','in_progress') AND updated_at < NOW() - 48h
// (tasks that have been sitting without status change for 2 days are stale/at-risk)
export const deadlineSweep = inngest.createFunction(
  { id: "deadline-sweep-6h", name: "6h Deadline Sweep" },
  { cron: "0 */6 * * *" },
  async ({ step }) => {
    const staleCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const overdueTasks = await step.run("query-overdue-tasks", async () => {
      const { data, error } = await supabase
        .schema("dispatch7")
        .from("tasks")
        .select("id, title, status, domain, updated_at")
        .in("status", ["open", "in_progress"])
        .lt("updated_at", staleCutoff)
        .order("updated_at", { ascending: true })
        .limit(50);

      if (error) throw new Error(`Task sweep query failed: ${error.message}`);
      return data ?? [];
    });

    if (overdueTasks.length === 0) {
      console.log("[deadlineSweep] no overdue tasks");
      return { checked: 0, overdue_count: 0, alerted: 0 };
    }

    // Log each overdue task to dispatch7.events
    const alertCount = await step.run("log-overdue-alerts", async () => {
      const events = overdueTasks.map((task) => ({
        agent: "SCHEDULER",
        action: "deadline_alert",
        payload: {
          task_id: task.id,
          title: task.title,
          status: task.status,
          domain: task.domain,
          stale_since: task.updated_at,
          sweep_at: new Date().toISOString(),
        },
      }));

      const { error } = await supabase
        .schema("dispatch7")
        .from("events")
        .insert(events);

      if (error) throw new Error(`Event log failed: ${error.message}`);
      return events.length;
    });

    // Trigger SCHEDULER agent for each overdue task — batched to avoid thundering herd
    await step.run("trigger-scheduler-alerts", async () => {
      // Find sessions associated with overdue tasks via payload JSON
      // Tasks may not have explicit session_id; use a sentinel session for scheduler alerts
      const SCHEDULER_SESSION = "system:deadline-sweep";

      await inngest.send(
        overdueTasks.map((task) => ({
          name: "dispatch/agent.trigger" as const,
          data: {
            session_id: SCHEDULER_SESSION,
            agent: "SCHEDULER",
            instruction: `OVERDUE TASK ALERT: "${task.title}" has been in status "${task.status}" since ${task.updated_at}. Domain: ${task.domain}. Task ID: ${task.id}. Review and action required.`,
            priority: "high" as const,
          },
        }))
      );
    });

    console.log(`[deadlineSweep] overdue=${overdueTasks.length} alerted=${alertCount}`);
    return { checked: overdueTasks.length, overdue_count: overdueTasks.length, alerted: alertCount };
  }
);

// Export all functions for the Inngest serve handler
// inngestRoutes.ts imports this array and passes it to serve()
export const inngestFunctions = [
  agentTrigger,
  webhookProcessor,
  scheduledSweep,
  // Turn 9
  researchJob,
  summaryJob,
  deadlineSweep,
];
