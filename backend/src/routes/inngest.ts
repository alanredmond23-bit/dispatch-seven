// Inngest webhook endpoint — receives events from Inngest Cloud / Dev Server
// POST /api/inngest — must be publicly reachable for Inngest to call back
// INNGEST_SIGNING_KEY used to verify request authenticity (never log it)

import { serve } from "inngest/hono";
import { Hono } from "hono";
import { inngest } from "../lib/inngest.js";
import { inngestFunctions } from "../inngest/functions.js";

export const inngestRoutes = new Hono();

const handler = serve({
  client: inngest,
  functions: inngestFunctions,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});

// Inngest sends GET (introspection) and POST (event delivery) to the same path
inngestRoutes.on(["GET", "POST", "PUT"], "/", (c) => handler(c));
