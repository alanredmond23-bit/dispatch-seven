// Hono middleware that checks per-session spend before executing a route
// If session has spent >= session_budget_usd, returns 402 with spend summary
// Register with: app.use('/api/*', budgetGuard)
import { Context, Next } from 'hono';
import { supabase } from '../lib/supabase.js';

export const DEFAULT_SESSION_BUDGET_USD = 2.00;

export async function budgetGuard(c: Context, next: Next) {
  const sessionId = c.req.header('x-session-id') ?? c.req.query('session_id');
  if (!sessionId) return next();

  const { data } = await supabase
    .from('agent_runs')
    .select('cost_usd')
    .eq('session_id', sessionId);

  const spent = (data ?? []).reduce((sum: number, r: any) => sum + (r.cost_usd ?? 0), 0);
  const budget = Number(c.req.header('x-budget-usd') ?? DEFAULT_SESSION_BUDGET_USD);

  if (spent >= budget) {
    return c.json({ error: 'budget_exceeded', spent_usd: spent, budget_usd: budget }, 402);
  }

  c.set('session_spent_usd', spent);
  return next();
}
