// TaskGraph.tsx — renders a session's decomposed task graph as a simple vertical list.
// Ponytail: no D3, no animation — just a list with status badges and dependency indent.
// Polls GET /api/v1/runs/task-graph?session_id=X every 3s.

import { useState, useEffect, useCallback } from "react";

export interface GraphTask {
  id:                 string;
  title:              string;
  agent:              string;
  status:             "pending" | "running" | "done" | "error" | string;
  dependencies:       string[];
  estimated_cost_usd: number | null;
}

interface TaskGraphProps {
  sessionId:    string;
  initialTasks: GraphTask[]; // provided immediately after /api/v1/decompose response
  onDismiss:    () => void;
}

const MONO = "'JetBrains Mono','Fira Code',monospace";
const SANS = "'Inter',system-ui,sans-serif";

const AGENT_C: Record<string, string> = {
  ORCHESTRATOR: "#1d4ed8",
  LEGAL:        "#dc2626",
  CODE:         "#7c3aed",
  RESEARCH:     "#d97706",
  SCHEDULER:    "#16a34a",
};

const STATUS_C: Record<string, string> = {
  pending: "#4a5568",
  running: "#3b82f6",
  done:    "#16a34a",
  error:   "#dc2626",
};

function agentColor(agent: string): string {
  return AGENT_C[agent.toUpperCase()] ?? "#4a5568";
}

function statusColor(status: string): string {
  return STATUS_C[status] ?? "#4a5568";
}

function statusIcon(status: string): string {
  if (status === "done")    return "✓";
  if (status === "running") return "▶";
  if (status === "error")   return "✗";
  return "○";
}

export default function TaskGraph({ sessionId, initialTasks, onDismiss }: TaskGraphProps) {
  const [tasks, setTasks] = useState<GraphTask[]>(initialTasks);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/v1/runs/task-graph?session_id=${encodeURIComponent(sessionId)}`
      );
      if (!res.ok) return;
      const data: { tasks: GraphTask[] } = await res.json();
      if (data.tasks?.length) setTasks(data.tasks);
    } catch {
      // silent — initial tasks already displayed
    }
  }, [sessionId]);

  useEffect(() => {
    const timer = setInterval(poll, 3_000);
    return () => clearInterval(timer);
  }, [poll]);

  // Build a lookup for dependency indentation
  const allIds = new Set(tasks.map((t) => t.id));
  const isDependent = (t: GraphTask) =>
    t.dependencies.some((d) => allIds.has(d));

  return (
    <div
      style={{
        background:   "#090e1a",
        border:       "1px solid #1a2540",
        borderLeft:   "3px solid #1d4ed8",
        marginBottom: "12px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display:        "flex",
          justifyContent: "space-between",
          alignItems:     "center",
          padding:        "10px 14px 8px",
          borderBottom:   "1px solid #1a2540",
        }}
      >
        <span
          style={{
            fontFamily:    MONO,
            fontSize:      "9px",
            color:         "#3b82f6",
            letterSpacing: "0.18em",
          }}
        >
          TASK DECOMPOSITION
        </span>
        <button
          onClick={onDismiss}
          style={{
            background:  "none",
            border:      "none",
            color:       "#4a5568",
            cursor:      "pointer",
            fontFamily:  MONO,
            fontSize:    "10px",
            padding:     "0 4px",
          }}
        >
          ✕
        </button>
      </div>

      {/* Task rows */}
      <div style={{ padding: "6px 0" }}>
        {tasks.map((task) => {
          const indent = isDependent(task);
          const done   = task.status === "done";

          return (
            <div
              key={task.id}
              style={{
                display:    "flex",
                alignItems: "flex-start",
                gap:        "10px",
                padding:    `6px 14px 6px ${indent ? "28px" : "14px"}`,
                opacity:    done ? 0.55 : 1,
              }}
            >
              {/* Status icon / checkbox */}
              <span
                style={{
                  fontFamily:  MONO,
                  fontSize:    "12px",
                  color:       statusColor(task.status),
                  minWidth:    "14px",
                  paddingTop:  "1px",
                }}
              >
                {statusIcon(task.status)}
              </span>

              {/* Title */}
              <span
                style={{
                  flex:           1,
                  fontFamily:     SANS,
                  fontSize:       "12px",
                  color:          done ? "#4a5568" : "#e2e8f0",
                  textDecoration: done ? "line-through" : "none",
                  lineHeight:     1.4,
                }}
              >
                {task.title}
              </span>

              {/* Agent badge */}
              <span
                style={{
                  fontFamily:    MONO,
                  fontSize:      "8px",
                  color:         agentColor(task.agent),
                  letterSpacing: "0.1em",
                  whiteSpace:    "nowrap",
                  paddingTop:    "2px",
                }}
              >
                {task.agent}
              </span>

              {/* Cost estimate */}
              {task.estimated_cost_usd != null && (
                <span
                  style={{
                    fontFamily:  MONO,
                    fontSize:    "9px",
                    color:       "#4a5568",
                    whiteSpace:  "nowrap",
                    paddingTop:  "2px",
                  }}
                >
                  ~${task.estimated_cost_usd.toFixed(3)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
