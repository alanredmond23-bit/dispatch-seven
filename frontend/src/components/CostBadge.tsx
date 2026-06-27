// CostBadge.tsx — session cost indicator in header
// Ponytail: one fetch call, native, no chart lib — just a number in a styled span.
// Updates every 30s via setInterval.

import { useState, useEffect } from "react";

type Run = { cost_usd: string | number };

export default function CostBadge({ sessionId }: { sessionId?: string }) {
  const [cost, setCost] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
        const res = await fetch(`/api/v1/runs${qs}`);
        if (!res.ok) return;
        const d: { runs: Run[] } = await res.json();
        const total = d.runs.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
        setCost(total);
      } catch {
        // non-critical — badge is display-only
      }
    };

    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [sessionId]);

  if (cost === null) return null;

  return (
    <span
      title="Cost this session (USD)"
      style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: "10px",
        letterSpacing: "0.08em",
        // amber when over $0.10, muted otherwise
        color: cost >= 0.10 ? "#d97706" : "#4a5568",
        background: "#090e1a",
        border: "1px solid #1a2540",
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      ${cost.toFixed(4)}
    </span>
  );
}
