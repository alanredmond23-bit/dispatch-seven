// Inngest webhook endpoint — receives events from Inngest Cloud / Dev Server
// POST /api/inngest — must be publicly reachable for Inngest to call back
// INNGEST_SIGNING_KEY used to verify request authenticity (never log it)
//
// NOTE: This file is intentionally kept thin. The serve() call lives in index.ts
// mounted directly with app.on() per the canonical Hono adapter pattern.
// This export is kept for backwards compatibility with any tooling that imports it.

export { inngestFunctions } from "../inngest/functions.js";
