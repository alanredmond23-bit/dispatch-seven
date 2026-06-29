// Supabase clients — D7 dual-schema setup
// Project: fifybuzwfaegloijrmqb
// Note: Node ≤20 lacks native WebSocket; pass ws package as transport.
// Cast to any — ws satisfies the interface at runtime, TS type mismatch is cosmetic.
//
// supabase    — scoped to dispatch7 schema  (app data, sessions, deadlines, memory)
// supabaseOps — scoped to dispatch_ops schema (legal evidence pipeline, Five9 index)

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE must be set");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase = createClient(url, key, {
  db: { schema: "dispatch7" },
  auth: { persistSession: false },
  realtime: { transport: ws as unknown as typeof WebSocket },
});

// dispatch_ops schema client — use for legal evidence pipeline tables
// (legal_evidence, legal_documents, etc.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabaseOps = createClient(url, key, {
  db: { schema: "dispatch_ops" },
  auth: { persistSession: false },
  realtime: { transport: ws as unknown as typeof WebSocket },
});
