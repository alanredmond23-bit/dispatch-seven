// deadlineSweep — Inngest cron job for deadline notifications
// Trigger: cron "0 8 * * *" (8am daily)
// Queries dispatch7.deadlines for items due within 7 days that have not been notified
// Logs notification for each, then marks notified=true

import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";

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

    // Step 2: Log notification for each deadline
    await step.run("notify-deadlines", async () => {
      for (const deadline of upcoming) {
        // Notification stub — replace with email/SMS/Slack when service is wired
        console.log(
          `[deadlineSweep] NOTIFICATION: case_id=${deadline.case_id} | "${deadline.description}" | due=${deadline.due_date} | id=${deadline.id}`
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
