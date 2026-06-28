// Real-time cost ticker that updates as WS token events arrive
// Shows: current session spend, tokens in/out, budget remaining as a progress bar
// Turns amber at >50% budget, red at >80% budget consumed
import { useEffect, useState } from 'react';
import { useAgentStream } from '../hooks/useAgentStream';

interface CostMeterProps {
  sessionId: string;
  budgetUsd?: number;
}

export function CostMeter({ sessionId, budgetUsd = 2.00 }: CostMeterProps) {
  const [spent, setSpent] = useState(0);
  const [tokensIn, setTokensIn] = useState(0);
  const [tokensOut, setTokensOut] = useState(0);
  const { lastEvent } = useAgentStream(sessionId);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === 'done') {
      setSpent(s => s + (lastEvent.cost_usd ?? 0));
      setTokensIn(t => t + (lastEvent.tokens_in ?? 0));
      setTokensOut(t => t + (lastEvent.tokens_out ?? 0));
    }
  }, [lastEvent]);

  const pct = Math.min((spent / budgetUsd) * 100, 100);
  const color = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#22c55e';

  return (
    <div style={{
      fontFamily: 'monospace',
      fontSize: 12,
      color: '#888',
      padding: '4px 8px',
      borderRadius: 6,
      background: '#111',
      display: 'flex',
      gap: 12,
      alignItems: 'center',
    }}>
      <span style={{ color }}>${spent.toFixed(4)}</span>
      <span>/ ${budgetUsd.toFixed(2)}</span>
      <div style={{ flex: 1, height: 4, background: '#333', borderRadius: 2 }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: color,
          borderRadius: 2,
          transition: 'width 0.3s',
        }} />
      </div>
      <span>{(tokensIn + tokensOut).toLocaleString()} tok</span>
    </div>
  );
}
