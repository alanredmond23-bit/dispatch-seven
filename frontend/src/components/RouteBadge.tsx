// RouteBadge — shows which agent is handling the current message
// Renders as a small pill while streaming; parent clears routeInfo on done

import React from 'react';

const DOMAIN_COLORS: Record<string, string> = {
  LEGAL:        '#b91c1c',
  CODE:         '#0369a1',
  RESEARCH:     '#0891b2',
  SCHEDULER:    '#a21caf',
  ORCHESTRATOR: '#1d4ed8',
};

interface RouteBadgeProps {
  agent: string;
  model: string;
}

export default function RouteBadge({ agent, model }: RouteBadgeProps) {
  const color = DOMAIN_COLORS[agent] ?? '#475569';
  // Extract short model label: "claude-sonnet-4-6" → "sonnet-4-6"
  const modelShort = model.replace('claude-', '').replace('-20251001', '');

  return (
    <div style={{
      display:      'inline-flex',
      alignItems:   'center',
      gap:          '6px',
      padding:      '3px 10px',
      border:       `1px solid ${color}`,
      background:   `${color}18`,
      fontFamily:   "'JetBrains Mono', monospace",
      fontSize:     '10px',
      letterSpacing:'0.12em',
      color,
      animation:    'pulse 1.4s ease-in-out infinite',
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, display: 'inline-block' }} />
      {agent} · {modelShort}
    </div>
  );
}
