// summaryJob — Inngest function for case summary generation
// Event trigger: "dispatch/summary.generate"
// Accepts { case_id: string }
// Pulls evidence from dispatch7.research_results, calls Claude, stores to dispatch7.summaries

import Anthropic from "@anthropic-ai/sdk";
import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";

export const summaryJob = inngest.createFunction(
  { id: "summary-job", name: "Summary Job" },
  { event: "dispatch/summary.generate" },
  async ({ event, step }) => {
    const { case_id } = event.data as {
      case_id: string;
    };

    // Step 1: Pull evidence for this case from research_results
    const evidence = await step.run("fetch-evidence", async () => {
      const { data, error } = await supabase
        .schema("dispatch7")
        .from("research_results")
        .select("query, result, created_at")
        .eq("case_id", case_id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        throw new Error(`[summaryJob] Evidence fetch failed: ${error.message}`);
      }

      // Also check evidence_chunks if research_results is empty
      if (!data || data.length === 0) {
        const { data: chunks, error: chunksError } = await supabase
          .schema("dispatch7")
          .from("evidence_chunks")
          .select("chunk_text, source, created_at")
          .eq("case_id", case_id)
          .order("created_at", { ascending: false })
          .limit(20);

        if (chunksError) {
          console.warn(`[summaryJob] evidence_chunks fallback failed: ${chunksError.message}`);
          return [];
        }
        return (chunks ?? []).map((c) => ({
          query: c.source ?? "evidence",
          result: c.chunk_text,
          created_at: c.created_at,
        }));
      }

      return data;
    });

    // Step 2: Generate summary via Claude
    const summary = await step.run("generate-claude-summary", async () => {
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      const evidenceText =
        evidence.length > 0
          ? evidence
              .map((e, i) => `[${i + 1}] Query: ${e.query}\nResult: ${e.result}`)
              .join("\n\n")
          : "No evidence records found for this case.";

      const message = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `You are a legal case analyst. Summarize the following research evidence for case ID "${case_id}". Be concise and factual. Highlight key findings, gaps, and recommended next steps.\n\nEVIDENCE:\n${evidenceText}`,
          },
        ],
      });

      const summaryText =
        message.content[0].type === "text"
          ? message.content[0].text
          : "Summary generation failed — unexpected response type.";

      console.log(`[summaryJob] Claude summary generated for case_id=${case_id} length=${summaryText.length}`);
      return summaryText;
    });

    // Step 3: Store summary to dispatch7.summaries
    await step.run("store-summary", async () => {
      const { error } = await supabase
        .schema("dispatch7")
        .from("summaries")
        .insert({
          case_id,
          summary,
          created_at: new Date().toISOString(),
        });

      if (error) {
        throw new Error(`[summaryJob] Supabase insert failed: ${error.message}`);
      }
      console.log(`[summaryJob] stored to dispatch7.summaries case_id=${case_id}`);
    });

    return { case_id, status: "completed", summary_length: summary.length };
  }
);
