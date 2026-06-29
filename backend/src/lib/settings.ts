// settings.ts — D7 operator settings service
// Reads/writes from dispatch7.settings (key-value jsonb table) with in-memory cache
// Source of truth for system prompt injection, model selection, and feature flags

import { supabase } from './supabase.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface D7Settings {
  // --- System prompt --------------------------------------------------------
  /** CLAUDE.md operator preferences — prepended to every agent system prompt */
  systemPromptBase: string;
  /** Per-agent system prompt overrides (domain key → additional prefix) */
  agentPromptOverrides: Record<string, string>;

  // --- Model config ---------------------------------------------------------
  /** Default Anthropic model for all agents */
  defaultModel: string;
  /** Per-agent model overrides — keyed by AgentDomain string */
  agentModelOverrides: Record<string, string>;
  // Provider routing (feat/provider-routing compat)
  agentProviderOverrides: Record<string, string>;
  defaultProvider: string;
  /** Max tokens per completion */
  maxTokens: number;

  // --- Memory ---------------------------------------------------------------
  /** Enable Mem0 memory injection */
  mem0Enabled: boolean;
  /** How many Mem0 memories to inject per request */
  mem0SearchLimit: number;

  // --- Parallel dispatch ----------------------------------------------------
  /** Allow parallel multi-agent dispatch */
  parallelEnabled: boolean;
  /** Max concurrent agents when parallelEnabled */
  parallelMaxConcurrency: number;

  // --- Legal mode -----------------------------------------------------------
  /** Enforce RED ZONE citation/label rules for legal content */
  legalRedZoneEnabled: boolean;
  /** Federal criminal case ID */
  legalCaseId: string;
  /** Bankruptcy case ID */
  bankruptcyCaseId: string;

  // --- Cost caps ------------------------------------------------------------
  /** Per-request USD budget cap (0 = unlimited) */
  budgetCapPerRequest: number;
  /** Daily USD budget cap (0 = unlimited) */
  budgetCapDaily: number;

  // --- Output ---------------------------------------------------------------
  /** Stream completions to clients */
  streamingEnabled: boolean;
  /** Enable context compaction when approaching window limit */
  contextCompactionEnabled: boolean;
  /** Remaining-token threshold at which compaction triggers */
  contextWindowThreshold: number;

  // --- Skills ---------------------------------------------------------------
  /** List of enabled skill domains */
  enabledSkills: string[];
}

// ---------------------------------------------------------------------------
// CLAUDE.md operator preferences (embedded verbatim as default system prompt)
// ---------------------------------------------------------------------------
const CLAUDE_MD_CONTENT = `## PRIME DIRECTIVE
Execute first. Do not argue. If a request is possible, do it. If blocked, state the exact blocker and give the closest executable alternative in the same response.
Treat Alan as the principal. Use decision-first structure: answer, evidence, action.
Be motivating but honest. No soft closers. No emojis. No filler. No moralizing. Dark humor. Decisive.

## OPERATING STYLE
Direct. Operational. McKinsey-grade. Plain English. Implementation-ready. Specific over generic. Assertive without pretending certainty.

## LEGAL RED ZONE
Federal criminal case 5:24-cr-00376 (trial Sept 14 2026), bankruptcy 4:24-bk-13093, custody, support, foreclosure are RED ZONE.
In RED ZONE: Do not invent law, facts, citations, docket entries, or quotes. Use citations. Label uncertain facts [UNVERIFIED]. Preserve attorney-client/work-product boundaries.

## OUTPUT CONTRACT
End substantive operational responses with:
IMPACT: which target(s)
TIME: estimate
PROBABILITY: X/1000 or N/A
ROADBLOCKS: concrete blockers or none
NEXT: one action

## NEVER USE THESE PHRASES
"I understand" / "I hear you" / "great question" / "as an AI" / "I hope this helps" / "let me know if"`;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
export const DEFAULTS: D7Settings = {
  systemPromptBase: CLAUDE_MD_CONTENT,
  agentPromptOverrides: {},
  defaultModel: 'claude-opus-4-8',
  agentModelOverrides: {},
  agentProviderOverrides: {},
  defaultProvider: 'anthropic',
  maxTokens: 16000,
  mem0Enabled: true,
  mem0SearchLimit: 10,
  parallelEnabled: false,
  parallelMaxConcurrency: 3,
  legalRedZoneEnabled: true,
  legalCaseId: '5:24-cr-00376',
  bankruptcyCaseId: '4:24-bk-13093',
  budgetCapPerRequest: 0.50,
  budgetCapDaily: 50.0,
  streamingEnabled: true,
  contextCompactionEnabled: true,
  contextWindowThreshold: 10000,
  enabledSkills: ['legal', 'research', 'deadline', 'evidence'],
};

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------
let _cache: D7Settings | null = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 60_000; // 60 s — short enough to pick up live changes

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/** Read all settings from Supabase, merging with DEFAULTS for any missing keys */
export async function getSettings(): Promise<D7Settings> {
  const now = Date.now();
  if (_cache && now - _cacheTs < CACHE_TTL_MS) return _cache;

  // Use public schema override because supabase client defaults to dispatch7 schema
  const { data, error } = await supabase
    .from('settings')
    .select('key, value');

  if (error) {
    // Fall back to defaults rather than crashing — settings DB may not be seeded yet
    console.warn('[settings] Supabase read failed, using defaults:', error.message);
    return DEFAULTS;
  }

  const merged: Record<string, unknown> = { ...DEFAULTS };
  for (const row of data ?? []) {
    merged[row.key] = row.value;
  }

  _cache = merged as unknown as D7Settings;
  _cacheTs = now;
  return _cache;
}

/** Fetch a single setting by key */
export async function getSetting<K extends keyof D7Settings>(key: K): Promise<D7Settings[K]> {
  const settings = await getSettings();
  return settings[key];
}

/** Persist one or more settings keys to Supabase and invalidate cache */
export async function updateSettings(patch: Partial<D7Settings>): Promise<D7Settings> {
  const upserts = Object.entries(patch).map(([key, value]) => ({
    key,
    value,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('settings')
    .upsert(upserts, { onConflict: 'key' });

  if (error) throw new Error(`[settings] Supabase write failed: ${error.message}`);

  // Invalidate cache — next read will re-fetch
  _cache = null;
  return getSettings();
}

/** Persist a single key */
export async function setSetting<K extends keyof D7Settings>(
  key: K,
  value: D7Settings[K],
): Promise<void> {
  await updateSettings({ [key]: value } as Partial<D7Settings>);
}

/** Reset all settings to DEFAULTS by wiping the table and re-seeding */
export async function resetSettings(): Promise<D7Settings> {
  // Delete all rows
  const { error: delErr } = await supabase.from('settings').delete().neq('key', '');
  if (delErr) throw new Error(`[settings] Reset delete failed: ${delErr.message}`);

  // Seed defaults
  const upserts = Object.entries(DEFAULTS).map(([key, value]) => ({
    key,
    value,
    updated_at: new Date().toISOString(),
  }));
  const { error: insErr } = await supabase.from('settings').upsert(upserts, { onConflict: 'key' });
  if (insErr) throw new Error(`[settings] Reset seed failed: ${insErr.message}`);

  _cache = null;
  return getSettings();
}

/** Invalidate in-memory cache (call after external DB changes) */
export function invalidateSettingsCache(): void {
  _cache = null;
  _cacheTs = 0;
}

// ── Provider-routing compatibility (feat/provider-routing) ──────────────────
// Re-exported so agent-loader.ts (which uses provider resolution) can import
// resolveProvider and DEFAULT_SETTINGS without a separate module.
import type { Provider } from './provider.js';

/** Pick the provider for a given agent. Priority: agent override → default → env → 'anthropic' */
export function resolveProvider(
  agentName: string,
  settings: Partial<D7Settings> = DEFAULTS,
): Provider {
  const override = settings.agentProviderOverrides?.[agentName] as Provider | undefined;
  if (override) return override;
  if (settings.defaultProvider) return settings.defaultProvider as Provider;
  const envProvider = process.env.DEFAULT_PROVIDER as Provider | undefined;
  if (envProvider) return envProvider;
  return 'anthropic';
}

/** Alias for DEFAULTS — used by agent-loader.ts */
export const DEFAULT_SETTINGS = DEFAULTS;
