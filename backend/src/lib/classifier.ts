// classifier.ts — synchronous keyword-based domain router (<5ms, zero API calls)
// Ponytail: keyword match now — upgrade to Haiku semantic when P1 ships

export type AgentDomain = 'LEGAL' | 'CODE' | 'RESEARCH' | 'SCHEDULER' | 'ORCHESTRATOR';

const DOMAIN_KEYWORDS: Record<AgentDomain, string[]> = {
  LEGAL: ['case', 'court', 'bankruptcy', 'criminal', 'attorney', 'motion', 'hearing',
          'judge', 'docket', 'legal', 'statute', 'subpoena', 'appeal', 'ruling',
          '5:24-cr', '4:24-bk', 'schmehl', 'mayer', 'redmond', 'five9', 'discharge',
          'trustee', 'adversary', 'complaint', 'indictment'],
  CODE: ['code', 'typescript', 'javascript', 'function', 'bug', 'error', 'build',
         'deploy', 'npm', 'git', 'pr', 'pull request', 'component', 'api', 'endpoint',
         'database', 'sql', 'migration', 'supabase', 'hono', 'react', 'tailwind'],
  RESEARCH: ['research', 'find', 'search', 'what is', 'who is', 'latest', 'news',
             'compare', 'analyze', 'report', 'landscape', 'competitive'],
  SCHEDULER: ['schedule', 'deadline', 'calendar', 'remind', 'reminder', 'when', 'date',
              'hearing date', 'due', 'cron', 'task', 'upcoming'],
  ORCHESTRATOR: [], // default fallback
};

export function classifyMessage(content: string): AgentDomain {
  const lower = content.toLowerCase();
  const scores: Record<AgentDomain, number> = {
    LEGAL: 0, CODE: 0, RESEARCH: 0, SCHEDULER: 0, ORCHESTRATOR: 0
  };
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) scores[domain as AgentDomain]++;
    }
  }
  // Tie-break: SCHEDULER wins ties — scheduling tasks are unambiguous even with legal keywords
  const top = Object.entries(scores).sort(([dA, a], [dB, b]) => {
    if (b - a !== 0) return b - a;
    if (dA === 'SCHEDULER') return -1;
    if (dB === 'SCHEDULER') return 1;
    return 0;
  })[0];
  return (top[1] > 0 ? top[0] : 'ORCHESTRATOR') as AgentDomain;
}
