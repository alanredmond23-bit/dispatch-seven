// agent-loader.ts — loads agent config (system prompt + model) by domain
// Reads SYSTEM_PROMPT export from /agents/{domain}.ts; falls back to safe default
// Ponytail: readFileSync at startup is fine — these files are tiny and local

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { AgentDomain } from './classifier.js';

// ESM-safe __dirname shim — project uses "type": "module" so __dirname is undefined at runtime
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface AgentConfig {
  name: AgentDomain;
  systemPrompt: string;
  model: string;
  maxTokens: number;
}

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

export function loadAgent(domain: AgentDomain): AgentConfig {
  // Resolve agents/ relative to project root (two levels up from backend/src/lib/)
  const agentsDir = join(__dirname, '..', '..', '..', '..', 'agents');
  const agentPath = join(agentsDir, `${domain.toLowerCase()}.ts`);
  const exportName = PROMPT_EXPORT_MAP[domain];

  let systemPrompt = `You are the ${domain} agent for Dispatch Seven. Be precise, cite sources, and follow the Ponytail ladder.`;

  try {
    const src = readFileSync(agentPath, 'utf-8');
    // Match: export const LEGAL_SYSTEM = `...` or similar
    const pattern = new RegExp(`${exportName}\\s*=\\s*\`([^\`]+)\``, 's');
    const match = src.match(pattern);
    if (match) systemPrompt = match[1].trim();
  } catch {
    // Agent file not found or unreadable — default prompt stands
  }

  return {
    name: domain,
    systemPrompt,
    model: MODEL_MAP[domain],
    maxTokens: domain === 'SCHEDULER' ? 1024 : 4096,
  };
}
