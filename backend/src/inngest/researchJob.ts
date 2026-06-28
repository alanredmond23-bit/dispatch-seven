// researchJob — Inngest function for research pipeline
// Event trigger: "dispatch/research.run"
// Accepts { query: string; case_id: string }
// Stores result to dispatch7.research_results

import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";

export const researchJob = inngest.createFunction(
  { id: "research-job", name: "Research Job" },
  { event: "dispatch/research.run" },
  async ({ event, step }) => {
    const { query, case_id } = event.data as {
      query: string;
      case_id: string;
    };

    // Step 1: Log research start
    await step.run("log-start", async () => {
      console.log(`[researchJob] starting case_id=${case_id} query="${query}"`);
    });

    // Step 2: Run research — stub logs and stores a placeholder result.
    // Replace the body of this step with a real agent/LLM call when ready.
    const result = await step.run("run-research", async () => {
      // Placeholder: in production, call a RESEARCH agent or LLM here.
      // e.g. const res = await callResearchAgent(query, case_id);
      const placeholder = `Research result for case ${case_id}: query "${query}" dispatched for analysis. [stub — wire real agent here]`;
      console.log(`[researchJob] result stub generated`);
      return placeholder;
    });

    // Step 3: Store result to dispatch7.research_results
    await step.run("store-result", async () => {
      const { error } = await supabase
        .schema("dispatch7")
        .from("research_results")
        .insert({
          case_id,
          query,
          result,
          created_at: new Date().toISOString(),
        });

      if (error) {
        throw new Error(`[researchJob] Supabase insert failed: ${error.message}`);
      }
      console.log(`[researchJob] stored to dispatch7.research_results case_id=${case_id}`);
    });

    return { case_id, query, status: "completed" };
  }
);
