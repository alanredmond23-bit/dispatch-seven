// Dashboard.tsx — Turn 10: multi-panel agent session dashboard
// Route: /dashboard (wired in App.tsx alongside /design)
// Layout:
//   Desktop: 3 columns — LEFT (session list) | CENTER (message feed) | RIGHT (TaskGraph + CostBar)
//   Mobile: single column with tab strip — SESSIONS | FEED | DETAIL
// Sessions sourced from useSessions() (5s poll).
// Message feed polls /api/v1/sessions/:id/messages every 5s when session selected.
// TaskGraph + CostBar reuse existing components (already poll independently once given sessionId).

import { useState, useEffect, useCallback, useRef } from "react";
import { useSessions, Session } from "../hooks/useSessions";
import TaskGraph from "../components/TaskGraph";
import CostBar from "../components/CostBar";

// ── Style constants ────────────────────────────────────────────────────────────
const MONO = "'JetBrains Mono','Fira Code',monospace";
const SANS = "'Inter',system-ui,sans-serif";
const BG   = "#050810";
const CARD = "#0a0f1a";
const BDR  = "#1e293b";

// ── Domain badge colours ───────────────────────────────────────────────────────
const DOMAIN_COLOR: Record<string, string> = {
  legal:       "#dc2626",
  research:    "#0891b2",
  finance:     "#047857",
  engineering: "#7c3aed",
  general:     "#475569",
};

// ── Agent colours (mirrors AgentDashboard) ────────────────────────────────────
const AGENT_COLOR: Record<string, string> = {
  ORCHESTRATOR: "#1d4ed8", LEGAL: "#b91c1c", DISCOVERY: "#7c3aed",
  FINANCE:      "#047857", BUILD: "#0369a1", QA: "#b45309",
  RESEARCH:     "#0891b2", COMMS: "#6d28d9", MEMORY: "#be185d",
  MONITOR:      "#0f766e", SCHEDULER: "#a21caf", EXECUTE: "#1d4ed8",
};

function agentColor(name: string): string {
  return AGENT_COLOR[name?.toUpperCase()] ?? "#475569";
}

function fmtCost(usd: number): string {
  return usd === 0 ? "$0.00" : `$${usd.toFixed(4)}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)  return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

// ── Message shape from /sessions/:id/messages ─────────────────────────────────
interface FeedMessage {
  id:          string;
  agent:       string;
  model:       string | null;
  status:      string;
  cost_usd:    number | null;
  started_at:  string;
  finished_at: string | null;
  instruction: string | null;
  tool_count:  number;
}

// ── LEFT PANEL — session list ──────────────────────────────────────────────────
interface SessionListProps {
  sessions:         Session[];
  loading:          boolean;
  selectedId:       string | null;
  onSelect:         (id: string) => void;
}

function SessionList({ sessions, loading, selectedId, onSelect }: SessionListProps) {
  if (loading && sessions.length === 0) {
    return (
      <div style={{ fontFamily: MONO, fontSize: "11px", color: "#4a5568", padding: "16px" }}>
        SCANNING SESSIONS...
      </div>
    );
  }

  return (
    <div style={{ width: "100%", overflowY: "auto", maxHeight: "calc(100vh - 120px)" }}>
      <div style={{
        fontFamily: MONO, fontSize: "9px", letterSpacing: "0.2em",
        color: "#94a3b8", padding: "12px 16px 8px", textTransform: "uppercase",
      }}>
        ACTIVE SESSIONS {sessions.length > 0 && `(${sessions.length})`}
      </div>

      {sessions.length === 0 && (
        <div style={{ fontFamily: SANS, fontSize: "12px", color: "#334155", padding: "12px 16px" }}>
          No sessions in last 24h.
        </div>
      )}

      {sessions.map((s) => {
        const isSelected = s.session_id === selectedId;
        return (
          <div
            key={s.session_id}
            onClick={() => onSelect(s.session_id)}
            style={{
              padding: "12px 16px",
              cursor: "pointer",
              background:    isSelected ? "#0d1425" : "transparent",
              borderLeft:    isSelected ? `2px solid ${DOMAIN_COLOR[s.domain] ?? "#475569"}` : "2px solid transparent",
              borderBottom:  `1px solid ${BDR}`,
              transition:    "background 0.1s",
            }}
          >
            {/* Session ID + domain badge */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
              <span style={{
                fontFamily: MONO, fontSize: "10px", color: "#e2e8f0",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: "140px",
              }}>
                {s.session_id.slice(-12)}
              </span>
              <span style={{
                fontFamily: MONO, fontSize: "8px", letterSpacing: "0.12em",
                color: DOMAIN_COLOR[s.domain] ?? "#475569",
                border: `1px solid ${DOMAIN_COLOR[s.domain] ?? "#475569"}`,
                padding: "1px 4px",
                flexShrink: 0,
              }}>
                {s.domain.toUpperCase()}
              </span>
            </div>

            {/* Last agent + cost + time */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{
                fontFamily: MONO, fontSize: "9px",
                color: agentColor(s.last_agent),
              }}>
                {s.last_agent}
              </span>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span style={{ fontFamily: MONO, fontSize: "9px", color: "#16a34a" }}>
                  {fmtCost(s.total_cost_usd)}
                </span>
                <span style={{ fontFamily: MONO, fontSize: "9px", color: "#334155" }}>
                  {s.run_count}r
                </span>
              </div>
            </div>
            <div style={{ fontFamily: MONO, fontSize: "9px", color: "#334155", marginTop: "2px" }}>
              {timeAgo(s.last_activity)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── CENTER PANEL — message feed ────────────────────────────────────────────────
interface MessageFeedProps {
  sessionId: string | null;
}

function MessageFeed({ sessionId }: MessageFeedProps) {
  const [messages, setMessages] = useState<FeedMessage[]>([]);
  const [loading, setLoading]   = useState(false);
  const bottomRef               = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async (sid: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/sessions/${encodeURIComponent(sid)}/messages?limit=50`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data: { messages: FeedMessage[] } = await res.json();
      setMessages(data.messages ?? []);
    } catch {
      // Keep showing last known messages
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sessionId) { setMessages([]); return; }
    loadMessages(sessionId);
    const interval = setInterval(() => loadMessages(sessionId), 5_000);
    return () => clearInterval(interval);
  }, [sessionId, loadMessages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  if (!sessionId) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100%", minHeight: "200px",
        fontFamily: MONO, fontSize: "11px", color: "#334155", letterSpacing: "0.12em",
      }}>
        SELECT A SESSION
      </div>
    );
  }

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        fontFamily: MONO, fontSize: "9px", letterSpacing: "0.2em", color: "#94a3b8",
        padding: "12px 16px 8px", textTransform: "uppercase",
        borderBottom: `1px solid ${BDR}`,
      }}>
        FEED — {sessionId.slice(-12)} {loading && "…"}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {messages.length === 0 && !loading && (
          <div style={{ fontFamily: SANS, fontSize: "12px", color: "#334155", padding: "16px" }}>
            No runs for this session yet.
          </div>
        )}

        {/* Reverse display: oldest at top, newest at bottom */}
        {[...messages].reverse().map((msg) => (
          <div
            key={msg.id}
            style={{
              padding: "10px 16px",
              borderBottom: `1px solid ${BDR}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{
                fontFamily: MONO, fontSize: "10px",
                color: agentColor(msg.agent),
              }}>
                {msg.agent}
              </span>
              <span style={{
                fontFamily: MONO, fontSize: "9px",
                color: msg.status === "completed" ? "#16a34a"
                     : msg.status === "failed"    ? "#dc2626"
                     : msg.status === "pending"   ? "#d97706"
                     : "#3b82f6",
              }}>
                {msg.status === "completed" ? "✓"
               : msg.status === "failed"    ? "✗"
               : msg.status === "pending"   ? "○"
               : "▶"} {msg.status}
              </span>
              {msg.cost_usd != null && msg.cost_usd > 0 && (
                <span style={{ fontFamily: MONO, fontSize: "9px", color: "#16a34a" }}>
                  ${msg.cost_usd.toFixed(4)}
                </span>
              )}
            </div>

            {msg.instruction && (
              <div style={{
                fontFamily: SANS, fontSize: "11px", color: "#94a3b8",
                lineHeight: 1.4, marginBottom: "4px",
                overflow: "hidden", display: "-webkit-box",
                WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
              } as React.CSSProperties}>
                {msg.instruction}
              </div>
            )}

            <div style={{ display: "flex", gap: "12px" }}>
              {msg.model && (
                <span style={{ fontFamily: MONO, fontSize: "9px", color: "#334155" }}>
                  {msg.model}
                </span>
              )}
              {msg.tool_count > 0 && (
                <span style={{ fontFamily: MONO, fontSize: "9px", color: "#334155" }}>
                  {msg.tool_count} tool(s)
                </span>
              )}
              <span style={{ fontFamily: MONO, fontSize: "9px", color: "#334155" }}>
                {timeAgo(msg.started_at)}
              </span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ── RIGHT PANEL — TaskGraph + CostBar ─────────────────────────────────────────
interface DetailPanelProps {
  sessionId: string | null;
}

function DetailPanel({ sessionId }: DetailPanelProps) {
  if (!sessionId) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100%", minHeight: "200px",
        fontFamily: MONO, fontSize: "11px", color: "#334155", letterSpacing: "0.12em",
      }}>
        SELECT A SESSION
      </div>
    );
  }

  return (
    <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{
        fontFamily: MONO, fontSize: "9px", letterSpacing: "0.2em", color: "#94a3b8",
        textTransform: "uppercase", marginBottom: "4px",
      }}>
        COST &amp; TASKS
      </div>

      {/* CostBar — polls /api/v1/runs/summary itself */}
      <CostBar sessionId={sessionId} />

      {/* TaskGraph — polls /api/v1/runs/task-graph itself */}
      <div style={{ marginTop: "8px" }}>
        <div style={{
          fontFamily: MONO, fontSize: "9px", letterSpacing: "0.16em", color: "#3b82f6",
          marginBottom: "8px",
        }}>
          TASK GRAPH
        </div>
        <TaskGraph
          sessionId={sessionId}
          initialTasks={[]}
          onDismiss={() => { /* noop — graph is always shown in dashboard */ }}
        />
      </div>
    </div>
  );
}

// ── Mobile tab strip ───────────────────────────────────────────────────────────
type DashTab = "sessions" | "feed" | "detail";

function TabStrip({ active, onChange }: { active: DashTab; onChange: (t: DashTab) => void }) {
  const tabs: Array<{ id: DashTab; label: string }> = [
    { id: "sessions", label: "SESSIONS" },
    { id: "feed",     label: "FEED"     },
    { id: "detail",   label: "DETAIL"   },
  ];

  return (
    <div style={{
      display: "flex",
      borderBottom: `1px solid ${BDR}`,
      background: CARD,
    }}>
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          style={{
            flex: 1,
            padding: "12px 0",
            background: "none",
            border: "none",
            borderBottom: active === id ? "2px solid #3b82f6" : "2px solid transparent",
            cursor: "pointer",
            fontFamily: MONO,
            fontSize: "9px",
            letterSpacing: "0.14em",
            color: active === id ? "#3b82f6" : "#475569",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Dashboard (main export) ────────────────────────────────────────────────────
export default function Dashboard() {
  const { sessions, loading } = useSessions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileTab, setMobileTab]   = useState<DashTab>("sessions");

  // Auto-select the most recent session when list first loads
  useEffect(() => {
    if (!selectedId && sessions.length > 0) {
      setSelectedId(sessions[0].session_id);
    }
  }, [sessions, selectedId]);

  // When user selects a session on mobile, switch to feed
  const handleSelect = (id: string) => {
    setSelectedId(id);
    setMobileTab("feed");
  };

  return (
    <div style={{
      background: BG,
      minHeight: "100vh",
      color: "#e2e8f0",
      fontFamily: SANS,
    }}>
      {/* Page header */}
      <div style={{
        padding: "14px 16px",
        borderBottom: `1px solid ${BDR}`,
        display: "flex",
        alignItems: "center",
        gap: "12px",
        background: CARD,
      }}>
        <a
          href="/"
          style={{
            fontFamily: MONO, fontSize: "9px", letterSpacing: "0.16em",
            color: "#475569", textDecoration: "none",
          }}
        >
          ← BACK
        </a>
        <span style={{ fontFamily: MONO, fontSize: "10px", letterSpacing: "0.2em", color: "#94a3b8" }}>
          D7 — DISPATCH DASHBOARD
        </span>
        <span style={{ fontFamily: MONO, fontSize: "9px", color: "#334155", marginLeft: "auto" }}>
          {sessions.length} SESSION{sessions.length !== 1 ? "S" : ""}
        </span>
      </div>

      {/* ── MOBILE layout (≤ 767px) — tab strip ─────────────────────────────── */}
      <div style={{ display: "block" }} className="d7-mobile-only">
        <TabStrip active={mobileTab} onChange={setMobileTab} />
        <div style={{ minHeight: "calc(100vh - 100px)" }}>
          {mobileTab === "sessions" && (
            <SessionList
              sessions={sessions}
              loading={loading}
              selectedId={selectedId}
              onSelect={handleSelect}
            />
          )}
          {mobileTab === "feed" && <MessageFeed sessionId={selectedId} />}
          {mobileTab === "detail" && <DetailPanel sessionId={selectedId} />}
        </div>
      </div>

      {/* ── DESKTOP layout (≥ 768px) — 3 columns ─────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr 300px",
          height: "calc(100vh - 53px)",
        }}
        className="d7-desktop-only"
      >
        {/* LEFT */}
        <div style={{ borderRight: `1px solid ${BDR}`, overflowY: "auto" }}>
          <SessionList
            sessions={sessions}
            loading={loading}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        {/* CENTER */}
        <div style={{ borderRight: `1px solid ${BDR}`, overflowY: "auto" }}>
          <MessageFeed sessionId={selectedId} />
        </div>

        {/* RIGHT */}
        <div style={{ overflowY: "auto" }}>
          <DetailPanel sessionId={selectedId} />
        </div>
      </div>
    </div>
  );
}
