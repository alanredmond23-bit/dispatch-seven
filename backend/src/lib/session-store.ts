// session-store.ts — in-memory flags for the current process lifetime
// Ponytail: no DB write needed for override flag — process-scoped is fine for single-instance ACA.
// Multi-instance: replace with supabase flag on claude_sessions if/when needed.

/** Session IDs that have been granted a budget override by the user. */
export const budgetOverrides = new Set<string>();
