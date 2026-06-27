// Actions parser — scans agent response text for embedded action blocks
// Extracts {"actions": [...]} JSON and inserts each into dispatch7.actions
//
// Agent responses can embed actions anywhere in free text, e.g.:
//   "Here is the docket summary. {"actions": [{"label": "View docket", "prompt": "...", "style": "primary"}]}"
//
// Usage: call parseAndInsertActions(responseText, session_id) after any agent call

import { supabase } from "../lib/supabase.js";

type ActionStyle = "primary" | "secondary" | "danger";

type ActionBlock = {
  label: string;
  prompt: string;
  style?: ActionStyle;
};

const VALID_STYLES: ActionStyle[] = ["primary", "secondary", "danger"];

// parseAndInsertActions — extract action blocks from response text and persist them
// Returns the count of actions inserted (0 if none found or all malformed)
export async function parseAndInsertActions(
  responseText: string,
  session_id: string
): Promise<number> {
  if (!responseText || !session_id) return 0;

  // Greedy regex: find all top-level JSON objects containing an "actions" key
  // Works with responses that mix prose and JSON
  const matches = responseText.match(/\{[^{}]*"actions"\s*:\s*\[[^\]]*\][^{}]*\}/gs);
  if (!matches) return 0;

  const actions: (ActionBlock & { session_id: string })[] = [];

  for (const match of matches) {
    try {
      const parsed = JSON.parse(match);
      if (!Array.isArray(parsed.actions)) continue;

      for (const a of parsed.actions) {
        if (!a.label || !a.prompt) continue; // skip malformed entries
        actions.push({
          session_id,
          label:  String(a.label).trim(),
          prompt: String(a.prompt).trim(),
          style:  VALID_STYLES.includes(a.style) ? a.style : "primary",
        });
      }
    } catch {
      // Unparseable match — skip silently
    }
  }

  if (!actions.length) return 0;

  const { error } = await supabase.from("actions").insert(actions);
  if (error) {
    console.error("[actions-parser] insert error:", error.message);
    return 0;
  }

  console.log(`[actions-parser] inserted ${actions.length} action(s) for session ${session_id}`);
  return actions.length;
}
