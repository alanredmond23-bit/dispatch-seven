// settings.ts — D7 application settings interface and defaults
// Consumed by agent-loader.ts (provider resolution) and ws.ts (streaming config)
// Ponytail: no persistence yet — in-memory defaults, env-var overrides only.
//           Phase 2: Supabase settings table for per-user overrides.

import type { Provider } from './provider.js';

export interface D7Settings {
  // ── MODEL DEFAULTS ────────────────────────────────────────────────────────
  defaultProvider: Provider;                     // 'anthropic' | 'openai' | 'groq' | 'ollama'
  defaultModel: string;                          // e.g. 'claude-sonnet-4-6'

  // ── PER-AGENT OVERRIDES ───────────────────────────────────────────────────
  agentProviderOverrides: Record<string, Provider>; // e.g. { LEGAL: 'anthropic', CODE: 'groq' }
  agentModelOverrides: Record<string, string>;       // e.g. { SCHEDULER: 'llama3-8b-8192' }

  // ── ENDPOINT CONFIG ───────────────────────────────────────────────────────
  openAIBaseURL: string;  // custom OpenAI-compatible proxy; '' = use SDK default

  // ── BUDGET ───────────────────────────────────────────────────────────────
  budgetCapUSD: number;   // per-session hard cap; default 1.00
}

export const DEFAULT_SETTINGS: D7Settings = {
  defaultProvider:        'anthropic',
  defaultModel:           'claude-sonnet-4-6',
  agentProviderOverrides: {},
  agentModelOverrides:    {},
  openAIBaseURL:          '',
  budgetCapUSD:           1.00,
};

/**
 * resolveProvider — picks the provider for a given agent name.
 * Priority: agent-level override → settings default → DEFAULT_PROVIDER env → 'anthropic'
 */
export function resolveProvider(
  agentName: string,
  settings: D7Settings = DEFAULT_SETTINGS,
): Provider {
  const agentOverride = settings.agentProviderOverrides[agentName];
  if (agentOverride) return agentOverride;

  if (settings.defaultProvider) return settings.defaultProvider;

  const envProvider = process.env.DEFAULT_PROVIDER as Provider | undefined;
  if (envProvider) return envProvider;

  return 'anthropic';
}
