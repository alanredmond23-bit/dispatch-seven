// agent-loader.ts — loads agent config (system prompt + model) by domain
// Reads SYSTEM_PROMPT export from /agents/{domain}.ts; falls back to safe default
// Settings: systemPromptBase (CLAUDE.md) is prepended to every agent prompt
// Model: agentModelOverrides[domain] takes priority over defaultModel > MODEL_MAP

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { AgentDomain } from './classifier.js';
import { getSettings } from './settings.js';

// ESM-safe __dirname shim — project uses "type": "module" so __dirname is undefined at runtime
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface AgentConfig {
  name: AgentDomain;
  systemPrompt: string;
  model: string;
  maxTokens: number;
}

// Fallback model map — used only when settings are unavailable
const MODEL_MAP: Record<AgentDomain, string> = {
  LEGAL:        'claude-sonnet-4-6',
  CODE:         'claude-sonnet-4-6',
  RESEARCH:     'claude-sonnet-4-6',
  SCHEDULER:    'claude-haiku-4-5-20251001', // fast for scheduling tasks
  ORCHESTRATOR: 'claude-sonnet-4-6',
};

// Agents whose files export a named const we can regex-extract
const PROMPT_EXPORT_MAP: Record<AgentDomain, string> = {
  LEGAL:        'LEGAL_SYSTEM',
  CODE:         'CODE_SYSTEM',
  RESEARCH:     'RESEARCH_SYSTEM',
  SCHEDULER:    'SCHEDULER_SYSTEM',
  ORCHESTRATOR: 'ORCHESTRATOR_SYSTEM',
};

/**
 * Load agent config for a domain, injecting:
 *   1. settings.systemPromptBase  (CLAUDE.md operator preferences)
 *   2. settings.agentPromptOverrides[domain]  (optional per-agent prefix)
 *   3. The agent's own system prompt from /agents/{domain}.ts
 *
 * Model priority: agentModelOverrides[domain] → defaultModel → MODEL_MAP[domain]
 */
export async function loadAgent(domain: AgentDomain): Promise<AgentConfig> {
  // Resolve agents/ relative to project root (two levels up from backend/src/lib/)
  const agentsDir = join(__dirname, '..', '..', '..', '..', 'agents');
  const agentPath = join(agentsDir, `${domain.toLowerCase()}.ts`);
  const exportName = PROMPT_EXPORT_MAP[domain];

  // --- Agent-specific system prompt from file ---
  let agentSystemPrompt = `You are the ${domain} agent for Dispatch Seven. Be precise, cite sources, and follow the Ponytail ladder.`;

  try {
    const src = readFileSync(agentPath, 'utf-8');
    // Match: export const LEGAL_SYSTEM = `...` or similar
    const pattern = new RegExp(`${exportName}\\s*=\\s*\`([^\`]+)\``, 's');
    const match = src.match(pattern);
    if (match) agentSystemPrompt = match[1].trim();
  } catch {
    // Agent file not found or unreadable — default prompt stands
  }

  // --- Fetch settings (cached, fast) ---
  let settings;
  try {
    settings = await getSettings();
  } catch {
    // Settings unavailable — fall back to plain prompt and MODEL_MAP
    return {
      name: domain,
      systemPrompt: agentSystemPrompt,
      model: MODEL_MAP[domain],
      maxTokens: domain === 'SCHEDULER' ? 1024 : 4096,
    };
  }

  // --- Build full system prompt: CLAUDE.md base + optional per-agent override + agent prompt ---
  const parts: string[] = [];

  if (settings.systemPromptBase) {
    // CLAUDE.md operator preferences — injected into every agent
    parts.push(settings.systemPromptBase);
  }

  const domainOverride = settings.agentPromptOverrides[domain];
  if (domainOverride) {
    // Per-agent additional instructions (e.g. extra legal constraints for LEGAL agent)
    parts.push(domainOverride);
  }

  parts.push(agentSystemPrompt);

  const systemPrompt = parts.join('\n\n---\n\n');

  // --- Model selection ---
  const model =
    settings.agentModelOverrides[domain] ??
    settings.defaultModel ??
    MODEL_MAP[domain];

  const maxTokens = settings.maxTokens ?? (domain === 'SCHEDULER' ? 1024 : 4096);

  return {
    name: domain,
    systemPrompt,
    model,
    maxTokens,
  };
}

/**
 * Synchronous fallback loadAgent for callers that cannot await.
 * Uses MODEL_MAP and skips settings injection — prefer loadAgent() where possible.
 */
export function loadAgentSync(domain: AgentDomain): AgentConfig {
  const agentsDir = join(__dirname, '..', '..', '..', '..', 'agents');
  const agentPath = join(agentsDir, `${domain.toLowerCase()}.ts`);
  const exportName = PROMPT_EXPORT_MAP[domain];

  let systemPrompt = `You are the ${domain} agent for Dispatch Seven. Be precise, cite sources, and follow the Ponytail ladder.`;

  try {
    const src = readFileSync(agentPath, 'utf-8');
    const pattern = new RegExp(`${exportName}\\s*=\\s*\`([^\`]+)\``, 's');
    const match = src.match(pattern);
    if (match) systemPrompt = match[1].trim();
  } catch {
    // default stands
  }

  return {
    name: domain,
    systemPrompt,
    model: MODEL_MAP[domain],
    maxTokens: domain === 'SCHEDULER' ? 1024 : 4096,
  };
}
