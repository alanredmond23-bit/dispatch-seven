// D7 Settings types — persisted via GET/PUT /api/settings

export interface AgentModelSettings {
  model: string;
  systemPromptOverride: string;
  enabled: boolean;
}

export interface MemoryEntry {
  id: string;
  content: string;
  timestamp: string;
  score?: number;
}

export interface JobEntry {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  costUsd?: number;
}

export interface ApiKeyEntry {
  name: string;
  maskedValue: string;
  status: 'healthy' | 'error' | 'unknown';
  lastUsed?: string;
}

export interface UsageDay {
  date: string;
  totalUsd: number;
}

export interface ServiceHealth {
  name: string;
  status: 'up' | 'down' | 'checking';
  lastChecked: string;
  latencyMs?: number;
}

export interface HealthResponse {
  services: ServiceHealth[];
  imageTag?: string;
  deployedAt?: string;
  wsConnected?: boolean;
}

export interface LegalAuditEntry {
  id: string;
  timestamp: string;
  query: string;
  matchedRule: string;
}

export const AGENTS = ['legal', 'research', 'deadline', 'evidence', 'decomposer', 'memory', 'scheduler'] as const;
export type AgentName = typeof AGENTS[number];

export const MODELS = [
  { id: 'claude-opus-4-8',           label: 'Claude Opus 4.8',   costPer1K: 0.045  },
  { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6', costPer1K: 0.009  },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  costPer1K: 0.0024 },
] as const;

export const SKILLS_CONFIG = [
  { id: 'legal',      label: 'Legal',      icon: '⚖', description: 'Federal criminal + bankruptcy research, motion drafting, deadline tracking' },
  { id: 'research',   label: 'Research',   icon: '◎', description: 'Multi-source legal + factual research with citation verification' },
  { id: 'deadline',   label: 'Deadline',   icon: '⧖', description: 'Court calendar management, speedy trial clock, filing windows' },
  { id: 'evidence',   label: 'Evidence',   icon: '▦', description: 'Five9 CDR indexing, exhibit preparation, Franks record construction' },
  { id: 'memory',     label: 'Memory',     icon: '◈', description: 'Persistent context via Mem0 — cross-session knowledge retention' },
  { id: 'decomposer', label: 'Decomposer', icon: '⊕', description: 'Multi-step goal decomposition into parallelizable sub-tasks' },
  { id: 'scheduler',  label: 'Scheduler',  icon: '⊞', description: 'Time-blocked day planning from GitHub issue backlog' },
];

export interface Settings {
  systemPromptBase: string;
  agentSettings: Record<string, AgentModelSettings>;
  defaultModel: string;
  maxTokens: number;
  mem0Enabled: boolean;
  memorySearchLimit: number;
  parallelEnabled: boolean;
  concurrency: number;
  legalModeEnabled: boolean;
  criminalCaseId: string;
  bankruptcyCaseId: string;
  budgetPerRequest: number;
  dailyBudget: number;
  alertThresholdEnabled: boolean;
  alertThresholdPercent: number;
  enabledSkills: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  systemPromptBase: `You are D7 — Dispatch Seven, Alan Redmond's AI command system.

OPERATING POSTURE: Execute first. No soft closers. No filler. No moralizing. McKinsey-grade precision.

LEGAL RED ZONE: Federal criminal 5:24-cr-00376 + bankruptcy 4:24-bk-13093 are active cases.
Never invent law, facts, citations, or docket entries. Label uncertain facts [UNVERIFIED].

TONE: Direct, operational, dark humor when appropriate. Treat Alan as the principal.`,
  agentSettings: {
    legal:      { model: 'claude-opus-4-8',           systemPromptOverride: '', enabled: true },
    research:   { model: 'claude-sonnet-4-6',         systemPromptOverride: '', enabled: true },
    deadline:   { model: 'claude-sonnet-4-6',         systemPromptOverride: '', enabled: true },
    evidence:   { model: 'claude-sonnet-4-6',         systemPromptOverride: '', enabled: true },
    decomposer: { model: 'claude-sonnet-4-6',         systemPromptOverride: '', enabled: true },
    memory:     { model: 'claude-haiku-4-5-20251001', systemPromptOverride: '', enabled: true },
    scheduler:  { model: 'claude-sonnet-4-6',         systemPromptOverride: '', enabled: true },
  },
  defaultModel: 'claude-sonnet-4-6',
  maxTokens: 8192,
  mem0Enabled: true,
  memorySearchLimit: 5,
  parallelEnabled: true,
  concurrency: 3,
  legalModeEnabled: true,
  criminalCaseId: '5:24-cr-00376',
  bankruptcyCaseId: '4:24-bk-13093',
  budgetPerRequest: 0.50,
  dailyBudget: 10.00,
  alertThresholdEnabled: true,
  alertThresholdPercent: 80,
  enabledSkills: ['legal', 'research', 'deadline', 'evidence', 'memory', 'decomposer', 'scheduler'],
};
