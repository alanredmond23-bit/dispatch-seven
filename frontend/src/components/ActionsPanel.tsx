// ActionsPanel — shows agent action log for a session.
// Polls GET /api/v1/actions?session_id=X every 5s.
// Collapsed by default; expand toggle reveals full payload.
// Hidden when 0 actions received.
// Ponytail: no external deps, inline styles match D7 design tokens.

import { useCallback, useEffect, useRef, useState } from "react";

interface ActionRow {
  id:         string;
  session_id: string;
  agent?:     string;
  type?:      string;
  payload?:   unknown;
  label?:     string;
  created_at: string;
}

const API_BASE = (import.meta as { env: Record<string, string> }).env?.VITE_API_URL ?? "";
const POLL_MS  = 5_000;

const AGENT_COLORS: Record<string, string> = {
  ORCHESTRATOR: "#1d4ed8",
  LEGAL:        "#dc2626",
  BUILD:        "#7c3aed",
  RESEARCH:     "#16a34a",
  FINANCE:      "#d97706",
  QA:           "#0891b2",
};

function agentColor(agent = ""): string {
  return AGENT_COLORS[agent.toUpperCase()] ?? "#4a5568";
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)  return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

function payloadPreview(payload: unknown): string {
  if (!payload) return "—";
  const s = typeof payload === "string" ? payload : JSON.stringify(payload);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

export default function ActionsPanel({ sessionId }: { sessionId: string }) {
  const [actions,   setActions]   = useState<ActionRow[]>([]);
  const [open,      setOpen]      = useState(false);
  const [expanded,  setExpanded]  = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchActions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/actions?session_id=${encodeURIComponent(sessionId)}&limit=20`);
      if (!res.ok) return;
      const data: ActionRow[] = await res.json();
      setActions(data);
    } catch {
      // silent — network hiccup shouldn't crash UI
    }
  }, [sessionId]);

  useEffect(() => {
    fetchActions();
    timerRef.current = setInterval(fetchActions, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchActions]);

  if (!actions.length) return null;

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div style={{ borderTop: "1px solid #1a2540", background: "#090e1a" }}>
      {/* Header / toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "8px 16px", background: "none",
          border: "none", cursor: "pointer", color: "#4a5568",
          fontFamily: "'JetBrains Mono', monospace", fontSize: "9px",
          letterSpacing: "0.18em",
        }}
      >
        <span>AGENT ACTIONS ({actions.length})</span>
        <span style={{ fontSize: "11px" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ maxHeight: "300px", overflowY: "auto", padding: "0 0 8px" }}>
          {actions.map((a) => {
            const isExpanded = expanded.has(a.id);
            const label = a.type ?? a.label ?? "action";
            const agent = a.agent ?? "SYSTEM";

            return (
              <div
                key={a.id}
                style={{
                  display: "flex", alignItems: "flex-start", gap: "10px",
                  padding: "7px 16px", borderBottom: "1px solid #0d1425",
                  cursor: a.payload ? "pointer" : "default",
                }}
                onClick={() => a.payload && toggleExpand(a.id)}
              >
                {/* Agent badge */}
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "8px",
                  letterSpacing: "0.12em", color: agentColor(agent),
                  background: agentColor(agent) + "22",
                  padding: "2px 6px", whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  {agent}
                </span>

                {/* Type + payload */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: "10px",
                    color: "#e2e8f0", marginBottom: isExpanded ? "4px" : 0,
                  }}>
                    {label}
                  </div>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: "9px",
                    color: "#4a5568", wordBreak: "break-word",
                  }}>
                    {isExpanded
                      ? JSON.stringify(a.payload, null, 2)
                      : payloadPreview(a.payload)}
                  </div>
                </div>

                {/* Timestamp */}
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "8px",
                  color: "#2d3748", whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  {relTime(a.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
