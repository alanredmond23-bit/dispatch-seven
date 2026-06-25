// Supabase client — D7 dispatch7 schema
// Project: fifybuzwfaegloijrmqb
// Keys pulled from env (set from Azure Key Vault at startup)

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE;

if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE must be set");
}

export const supabase = createClient(url, key, {
  db: { schema: "dispatch7" },
  auth: { persistSession: false },
});
