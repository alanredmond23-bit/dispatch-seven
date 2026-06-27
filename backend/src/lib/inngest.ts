// Inngest client — durable event-driven execution for D7 agents
// Replaces polling-based listener pattern with real-event triggers
// Event key sourced from INNGEST_EVENT_KEY (never hardcoded)

import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "dispatch-seven",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
