// DagView.tsx — live DAG node graph for Turn 7
// Polls GET /api/v1/dag/:session_id every 3s.
// Stops polling when all nodes are done or failed.
// Layout: nodes with no deps at top, dependents below, SVG connector lines.

import { useState, useEffect, useCallback, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type NodeStatus = "queued" | "running" | "done" | "failed";

interface DagNode {
  id: string;
  type: string;
  status: NodeStatus;
  started_at: string | null;
  completed_at: string | null;
  output: unknown;
  deps: string[];
}

interface DagResponse {
  session_id: string;
  nodes: DagNode[];
}

interface DagViewProps {
  sessionId: string;
}

// ── Design tokens ──────────────────────────────────────────────────────────

const BG       = "#0A0A0F";
const SURFACE  = "#111118";
const BORDER   = "#1E1E2E";
const ACCENT   = "#5B6EF5";
const TEXT     = "#E8E8F0";
const TEXT_2   = "#8888AA";
const MONO     = "'JetBrains Mono','Fira Code',monospace";
const SANS     = "'Inter',system-ui,sans-serif";

const STATUS_COLOR: Record<NodeStatus, string> = {
  queued:  "#555577",
  running: "#F5A623",
  done:    "#22C55E",
  failed:  "#EF4444",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function statusLabel(s: NodeStatus): string {
  return s.toUpperCase();
}

function isTerminal(nodes: DagNode[]): boolean {
  if (nodes.length === 0) return false;
  return nodes.every((n) => n.status === "done" || n.status === "failed");
}

/** Assign a vertical level to each node via BFS from roots. */
function computeLevels(nodes: DagNode[]): Map<string, number> {
  const levels = new Map<string, number>();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  function level(id: string): number {
    if (levels.has(id)) return levels.get(id)!;
    const node = nodeMap.get(id);
    if (!node || node.deps.length === 0) {
      levels.set(id, 0);
      return 0;
    }
    const maxDep = Math.max(...node.deps.map((d) => level(d)));
    const l = maxDep + 1;
    levels.set(id, l);
    return l;
  }

  for (const n of nodes) level(n.id);
  return levels;
}

// ── Node card ──────────────────────────────────────────────────────────────

interface NodeCardProps {
  node: DagNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

const NODE_W = 180;
const NODE_H = 64;
const H_GAP  = 32;
const V_GAP  = 72;

// ── Component ──────────────────────────────────────────────────────────────

export default function DagView({ sessionId }: DagViewProps) {
  const [nodes, setNodes] = useState<DagNode[]>([]);
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/dag/${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DagResponse = await res.json();
      setNodes(data.nodes ?? []);
      setLoading(false);

      if (isTerminal(data.nodes ?? [])) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    poll();
    timerRef.current = setInterval(poll, 3_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [poll]);

  // ── Layout ───────────────────────────────────────────────────────────────

  const levels = computeLevels(nodes);
  const maxLevel = nodes.length > 0 ? Math.max(...[...levels.values()]) : 0;

  // Group nodes by level
  const byLevel = new Map<number, DagNode[]>();
  for (const node of nodes) {
    const l = levels.get(node.id) ?? 0;
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)!.push(node);
  }

  // Compute pixel positions
  const positions = new Map<string, { x: number; y: number }>();
  for (let lvl = 0; lvl <= maxLevel; lvl++) {
    const row = byLevel.get(lvl) ?? [];
    const rowWidth = row.length * NODE_W + (row.length - 1) * H_GAP;
    const startX = Math.max(0, (600 - rowWidth) / 2);
    row.forEach((n, i) => {
      positions.set(n.id, {
        x: startX + i * (NODE_W + H_GAP),
        y: lvl * (NODE_H + V_GAP) + 16,
      });
    });
  }

  const svgH = (maxLevel + 1) * (NODE_H + V_GAP) + 32;
  const svgW = 640;

  // Build SVG edge lines
  const edges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (const node of nodes) {
    const to = positions.get(node.id);
    if (!to) continue;
    for (const dep of node.deps) {
      const from = positions.get(dep);
      if (!from) continue;
      edges.push({
        x1: from.x + NODE_W / 2,
        y1: from.y + NODE_H,
        x2: to.x + NODE_W / 2,
        y2: to.y,
      });
    }
  }

  // Progress
  const doneCount   = nodes.filter((n) => n.status === "done").length;
  const failedCount = nodes.filter((n) => n.status === "failed").length;
  const total       = nodes.length;
  const allDone     = isTerminal(nodes);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        background:   BG,
        border:       `1px solid ${BORDER}`,
        borderLeft:   `3px solid ${ACCENT}`,
        borderRadius: "4px",
        padding:      "16px",
        fontFamily:   SANS,
      }}
    >
      {/* Header */}
      <div
        style={{
          display:        "flex",
          justifyContent: "space-between",
          alignItems:     "center",
          marginBottom:   "12px",
        }}
      >
        <span
          style={{
            fontFamily:    MONO,
            fontSize:      "10px",
            color:         ACCENT,
            letterSpacing: "0.15em",
          }}
        >
          DAG EXECUTOR
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize:   "10px",
            color:      allDone ? "#22C55E" : TEXT_2,
          }}
        >
          {doneCount}/{total} DONE
          {failedCount > 0 && (
            <span style={{ color: "#EF4444", marginLeft: "8px" }}>
              {failedCount} FAILED
            </span>
          )}
          {!allDone && total > 0 && (
            <span style={{ marginLeft: "8px", color: "#F5A623" }}>● LIVE</span>
          )}
        </span>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ color: TEXT_2, fontFamily: MONO, fontSize: "11px", padding: "16px 0" }}>
          Loading DAG…
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            color:      "#EF4444",
            fontFamily: MONO,
            fontSize:   "11px",
            padding:    "8px",
            background: "#1a0505",
            borderRadius: "2px",
          }}
        >
          Error: {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && nodes.length === 0 && (
        <div style={{ color: TEXT_2, fontFamily: MONO, fontSize: "11px", padding: "16px 0" }}>
          No nodes found for session.
        </div>
      )}

      {/* SVG graph */}
      {nodes.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            width={svgW}
            height={svgH}
            style={{ display: "block" }}
          >
            {/* Edge lines */}
            {edges.map((e, i) => (
              <line
                key={i}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke={BORDER}
                strokeWidth="1.5"
                strokeDasharray="4 3"
                markerEnd="url(#arrow)"
              />
            ))}

            {/* Arrow marker */}
            <defs>
              <marker
                id="arrow"
                markerWidth="6"
                markerHeight="6"
                refX="3"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L0,6 L6,3 z" fill={BORDER} />
              </marker>
            </defs>

            {/* Node cards */}
            {nodes.map((node) => {
              const pos = positions.get(node.id) ?? { x: 0, y: 0 };
              const dotColor = STATUS_COLOR[node.status] ?? "#555577";
              const isPulsing = node.status === "running";

              return (
                <g key={node.id} transform={`translate(${pos.x},${pos.y})`}>
                  {/* Card background */}
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx="4"
                    fill={SURFACE}
                    stroke={node.status === "running" ? ACCENT : BORDER}
                    strokeWidth={node.status === "running" ? 1.5 : 1}
                  />

                  {/* Status dot */}
                  <circle
                    cx={14}
                    cy={NODE_H / 2}
                    r={5}
                    fill={dotColor}
                    opacity={isPulsing ? 0.9 : 1}
                  >
                    {isPulsing && (
                      <animate
                        attributeName="opacity"
                        values="1;0.3;1"
                        dur="1.2s"
                        repeatCount="indefinite"
                      />
                    )}
                  </circle>

                  {/* Node type badge */}
                  <text
                    x={26}
                    y={22}
                    fontFamily={MONO}
                    fontSize="8"
                    fill={ACCENT}
                    letterSpacing="0.1"
                  >
                    {node.type}
                  </text>

                  {/* Node id */}
                  <text
                    x={26}
                    y={37}
                    fontFamily={SANS}
                    fontSize="11"
                    fill={TEXT}
                  >
                    {node.id.length > 14 ? node.id.slice(0, 14) + "…" : node.id}
                  </text>

                  {/* Status label */}
                  <text
                    x={26}
                    y={52}
                    fontFamily={MONO}
                    fontSize="8"
                    fill={dotColor}
                    letterSpacing="0.08"
                  >
                    {statusLabel(node.status)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* Footer: overall progress bar */}
      {total > 0 && (
        <div style={{ marginTop: "12px" }}>
          <div
            style={{
              height:       "3px",
              background:   BORDER,
              borderRadius: "2px",
              overflow:     "hidden",
            }}
          >
            <div
              style={{
                height:       "100%",
                width:        `${(doneCount / total) * 100}%`,
                background:   allDone ? "#22C55E" : ACCENT,
                transition:   "width 0.4s ease",
                borderRadius: "2px",
              }}
            />
          </div>
          <div
            style={{
              marginTop:  "4px",
              fontFamily: MONO,
              fontSize:   "9px",
              color:      TEXT_2,
              textAlign:  "right",
            }}
          >
            {Math.round((doneCount / total) * 100)}% complete
          </div>
        </div>
      )}
    </div>
  );
}
