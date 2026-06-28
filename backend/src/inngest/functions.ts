// Inngest function definitions for D7 — event-driven agent orchestration
// Three original functions: agentTrigger, webhookProcessor, scheduledSweep
// researchJob, summaryJob, deadlineSweep now live in their own files
// (spec-compliant triggers, correct schema targets, Claude integration)

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

// ── Turn 7: Legal pipeline jobs ───────────────────────────────────────────────
// five9IndexJob   — nightly Azure blob → legal_evidence upsert
// voyageBackfillJob — nightly + on-demand Voyage AI embedding backfill
export { five9IndexJob, voyageBackfillJob } from "./legal-jobs.js";
import { five9IndexJob, voyageBackfillJob } from "./legal-jobs.js";

// Export all original functions for the Inngest serve handler.
// researchJob, summaryJob, deadlineSweep are imported separately in index.ts
// and spread into the functions array there.
export const inngestFunctions = [
  agentTrigger,
  webhookProcessor,
  scheduledSweep,
  five9IndexJob,
  voyageBackfillJob,
];
