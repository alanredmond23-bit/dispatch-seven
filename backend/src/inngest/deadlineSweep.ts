// deadlineSweep — Inngest cron job for deadline notifications
// Trigger: cron "0 8 * * *" (8am daily)
// Queries dispatch7.deadlines for items due within 7 days that have not been notified
// Delivers real push notification via ntfy.sh, then marks notified=true

import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";

const NTFY_TOPIC = process.env.NTFY_TOPIC ?? 'dispatch7-alerts';

/** Send a push notification via ntfy.sh. Falls back to console.log if fetch fails. */
async function sendNtfyAlert(title: string, body: string): Promise<void> {
  if (!process.env.NTFY_TOPIC && process.env.NODE_ENV !== 'production') {
    // NTFY_TOPIC not set — log and skip to avoid spamming public topic in dev
    console.log(`[deadlineSweep] NOTIFICATION (ntfy not configured): ${body}`);
    return;
  }
  try {
    await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Title': title,
        'Priority': 'urgent',
        'Tags': 'alarm_clock',
      },
      body,
    });
  } catch (err) {
    // ntfy.sh unreachable — fall back to console so the function doesn't error
    console.log(`[deadlineSweep] NOTIFICATION (ntfy failed, fallback): ${body}`, err);
  }
}

export const deadlineSweep = inngest.createFunction(
  { id: "deadline-sweep", name: "Daily Deadline Sweep" },
  { cron: "0 8 * * *" },
  async ({ step }) => {
    // Step 1: Query deadlines due within 7 days that haven't been notified
    const upcoming = await step.run("query-upcoming-deadlines", async () => {
      const now = new Date();
      const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const { data, error } = await supabase
        .schema("dispatch7")
        .from("deadlines")
        .select("id, case_id, description, due_date, notified")
        .lte("due_date", sevenDaysOut.toISOString())
        .eq("notified", false)
        .order("due_date", { ascending: true });

      if (error) {
        throw new Error(`[deadlineSweep] Deadline query failed: ${error.message}`);
      }

      return data ?? [];
    });

    if (upcoming.length === 0) {
      console.log("[deadlineSweep] No upcoming deadlines requiring notification.");
      return { notified: 0 };
    }

    // Step 2: Send real ntfy.sh notification for each deadline
    await step.run("notify-deadlines", async () => {
      for (const deadline of upcoming) {
        await sendNtfyAlert(
          'D7 Deadline Alert',
          `DEADLINE: ${deadline.description} — ${deadline.due_date}`
        );
      }
    });

    // Step 3: Mark all notified deadlines with notified=true
    const notifiedIds = upcoming.map((d) => d.id);
    await step.run("mark-notified", async () => {
      const { error } = await supabase
        .schema("dispatch7")
        .from("deadlines")
        .update({ notified: true })
        .in("id", notifiedIds);

      if (error) {
        throw new Error(`[deadlineSweep] Failed to mark deadlines notified: ${error.message}`);
      }
      console.log(`[deadlineSweep] marked ${notifiedIds.length} deadline(s) as notified`);
    });

    return { notified: notifiedIds.length };
  }
);
