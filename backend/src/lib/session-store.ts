// session-store.ts — budget override flags with DB-backed persistence
// In-memory Set is the hot path; Supabase is the durable backing store.
// On startup: loads non-expired rows from dispatch7.budget_overrides into Set.
// On add: writes to DB with 24h TTL so overrides survive process restarts.
// Multi-instance note: each instance loads on startup — eventual consistency only.
//   Replace with a realtime subscription if strict cross-instance sync is needed.

import { supabase } from './supabase.js';

/** Session IDs that have been granted a budget override by the user (hot path). */
export const budgetOverrides = new Set<string>();

/** Persist a budget override to DB and add to in-memory Set. */
export async function addBudgetOverride(sessionId: string): Promise<void> {
  budgetOverrides.add(sessionId);

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .schema('dispatch7')
    .from('budget_overrides')
    .upsert({ session_id: sessionId, expires_at: expiresAt }, { onConflict: 'session_id' });

  if (error) {
    // Non-fatal — in-memory grant still stands for this process lifetime
    console.warn(`[session-store] Failed to persist budget override for ${sessionId}: ${error.message}`);
  }
}

/** Load non-expired overrides from DB into the in-memory Set. Call once at startup. */
export async function loadBudgetOverrides(): Promise<void> {
  // Cleanup: purge expired rows first to keep the table lean
  await supabase
    .schema('dispatch7')
    .from('budget_overrides')
    .delete()
    .lt('expires_at', new Date().toISOString());

  const { data, error } = await supabase
    .schema('dispatch7')
    .from('budget_overrides')
    .select('session_id')
    .gte('expires_at', new Date().toISOString());

  if (error) {
    console.warn(`[session-store] Failed to load budget overrides from DB: ${error.message}`);
    return;
  }

  for (const row of data ?? []) {
    budgetOverrides.add(row.session_id);
  }

  console.log(`[session-store] Loaded ${budgetOverrides.size} active budget override(s) from DB`);
}
