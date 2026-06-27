// ActionBar — polls dispatch7.actions and renders agent-generated buttons
// Props:
//   sessionId — identifies which actions to fetch
//   onSubmit  — called with the action's prompt when a button is clicked (re-submits to chat)
//   apiBase   — defaults to /api/v1; override in tests or if backend moves

import { useState, useEffect, useRef } from "react";

type ActionStyle = "primary" | "secondary" | "danger";

type Action = {
  id: string;
  label: string;
  prompt: string;
  style: ActionStyle;
};

// Visual mapping: primary=blue, secondary=gray, danger=red
const STYLE_PROPS: Record<ActionStyle, React.CSSProperties> = {
  primary:   { background: "#1d4ed8", color: "#ffffff", border: "1px solid #1d4ed8" },
  secondary: { background: "#1e293b", color: "#94a3b8", border: "1px solid #334155" },
  danger:    { background: "#dc2626", color: "#ffffff", border: "1px solid #dc2626" },
};

interface ActionBarProps {
  sessionId: string;
  onSubmit: (prompt: string) => void;
  apiBase?: string;
}

export default function ActionBar({ sessionId, onSubmit, apiBase = "/api/v1" }: ActionBarProps) {
  const [actions, setActions]     = useState<Action[]>([]);
  const [executing, setExecuting] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = async () => {
    try {
      const res = await fetch(`${apiBase}/actions?session_id=${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setActions(data.actions ?? []);
    } catch {
      // network blip — keep existing state, retry next tick
    }
  };

  useEffect(() => {
    if (!sessionId) return;
    poll(); // immediate first fetch
    timerRef.current = setInterval(poll, 3000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionId, apiBase]);

  const handleClick = async (action: Action) => {
    if (executing) return; // one inflight at a time
    setExecuting(action.id);
    try {
      const res = await fetch(`${apiBase}/actions/${action.id}/execute`, { method: "POST" });
      if (!res.ok) return;
      const data = await res.json();
      // Remove from local state immediately — no need to wait for next poll
      setActions((prev) => prev.filter((a) => a.id !== action.id));
      if (data.prompt) onSubmit(data.prompt);
    } catch {
      // noop — action stays visible, user can retry
    } finally {
      setExecuting(null);
    }
  };

  // Completely invisible when no pending actions (no spinner, no empty div)
  if (!actions.length) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
        padding: "10px 0 4px",
        borderTop: "1px solid #1e293b",
      }}
    >
      {actions.map((action) => {
        const styleProps = STYLE_PROPS[action.style] ?? STYLE_PROPS.primary;
        const isRunning  = executing === action.id;
        return (
          <button
            key={action.id}
            onClick={() => handleClick(action)}
            disabled={!!executing}
            style={{
              ...styleProps,
              padding: "8px 16px",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: "11px",
              letterSpacing: "0.08em",
              cursor: executing ? "default" : "pointer",
              opacity: isRunning ? 0.6 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {isRunning ? "..." : action.label}
          </button>
        );
      })}
    </div>
  );
}
