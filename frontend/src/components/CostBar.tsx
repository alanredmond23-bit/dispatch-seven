// CostBar.tsx — budget progress bar + per-agent cost breakdown
// Fetches /api/v1/runs/summary?session_id=X every 10s.
// Ponytail: pure CSS bar, no chart lib, no extra deps.

import { useState, useEffect, useCallback } from "react";

interface AgentCost {
  agent:     string;
  cost_usd:  number;
  run_count: number;
}

interface Summary {
  session_total_usd: number;
  budget_cap_usd:    number;
  budget_pct:        number;
  by_agent:          AgentCost[];
  daily_total_usd:   number;
}

interface CostBarProps {
  sessionId:   string;
  onSummary?:  (s: Summary) => void; // T3c/T3d: let App.tsx read daily total + budget_pct
}

const MONO = "'JetBrains Mono','Fira Code',monospace";

function barColor(pct: number): string {
  if (pct >= 100) return "#dc2626"; // red
  if (pct >= 80)  return "#d97706"; // amber
  return "#16a34a";                  // green
}

export default function CostBar({ sessionId, onSummary }: CostBarProps) {
  const [summary, setSummary] = useState<Summary | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/v1/runs/summary?session_id=${encodeURIComponent(sessionId)}`
      );
      if (!res.ok) return;
      const data: Summary = await res.json();
      setSummary(data);
      onSummary?.(data);
    } catch {
      // non-critical display component — fail silently
    }
  }, [sessionId, onSummary]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!summary) return null;

  const { session_total_usd, budget_cap_usd, budget_pct, by_agent } = summary;
  const color = barColor(budget_pct);
  const pct   = Math.min(100, budget_pct);

  return (
    <div style={{ padding: "8px 16px 4px", borderBottom: "1px solid #1a2540" }}>
      {/* Bar row */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {/* Track */}
        <div
          style={{
            flex: 1,
            height: "6px",
            background: "#1a2540",
            borderRadius: "3px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: color,
              borderRadius: "3px",
              transition: "width 0.4s ease, background 0.3s ease",
            }}
          />
        </div>

        {/* Amount label */}
        <span
          style={{
            fontFamily: MONO,
            fontSize: "10px",
            color,
            whiteSpace: "nowrap",
            letterSpacing: "0.06em",
          }}
        >
          ${session_total_usd.toFixed(2)} / ${budget_cap_usd.toFixed(2)}
        </span>

        {/* Pct label */}
        <span
          style={{
            fontFamily: MONO,
            fontSize: "10px",
            color: "#4a5568",
            minWidth: "34px",
            textAlign: "right",
          }}
        >
          {pct.toFixed(0)}%
        </span>
      </div>

      {/* Warning text */}
      {budget_pct >= 100 && (
        <div
          style={{
            fontFamily: MONO,
            fontSize: "9px",
            color: "#dc2626",
            letterSpacing: "0.14em",
            marginTop: "3px",
          }}
        >
          BUDGET REACHED — SESSION LOCKED
        </div>
      )}
      {budget_pct >= 80 && budget_pct < 100 && (
        <div
          style={{
            fontFamily: MONO,
            fontSize: "9px",
            color: "#d97706",
            letterSpacing: "0.14em",
            marginTop: "3px",
          }}
        >
          APPROACHING LIMIT
        </div>
      )}

      {/* Agent chips */}
      {by_agent.length > 0 && (
        <div
          style={{
            marginTop: "5px",
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          {by_agent.map((a) => (
            <span
              key={a.agent}
              style={{
                fontFamily: MONO,
                fontSize: "9px",
                color: "#4a5568",
                letterSpacing: "0.08em",
                whiteSpace: "nowrap",
              }}
            >
              {a.agent} ${a.cost_usd.toFixed(3)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
