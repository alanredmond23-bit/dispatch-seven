// D7 — Dispatch Seven | Root App
// Design system: #050810 bg | JetBrains Mono headers | Inter body | 1px borders

import { useState } from "react";
import AgentDashboard from "./components/AgentDashboard";
import TaskQueue from "./components/TaskQueue";
import MemoryViewer from "./components/MemoryViewer";
import EventLog from "./components/EventLog";

type Tab = "agents" | "tasks" | "memory" | "events";

export default function App() {
  const [tab, setTab] = useState<Tab>("agents");

  const tabs: { id: Tab; label: string }[] = [
    { id: "agents", label: "12 AGENTS" },
    { id: "tasks", label: "TASK QUEUE" },
    { id: "memory", label: "MEMORY" },
    { id: "events", label: "EVENT LOG" },
  ];

  return (
    <div style={{ background: "#050810", minHeight: "100vh", color: "#e2e8f0", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <header style={{ borderBottom: "1px solid #1e293b", padding: "16px 24px", display: "flex", alignItems: "center", gap: "16px" }}>
        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "20px", fontWeight: 700, letterSpacing: "0.1em" }}>
          D7 <span style={{ color: "#1d4ed8" }}>DISPATCH SEVEN</span>
        </span>
        <span style={{ fontSize: "11px", color: "#475569", fontFamily: "JetBrains Mono, monospace" }}>
          12-AGENT SWARM | ANTHROPIC TIER 4
        </span>
      </header>

      {/* Nav */}
      <nav style={{ borderBottom: "1px solid #1e293b", display: "flex", padding: "0 24px" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "12px 20px", fontSize: "11px", fontFamily: "JetBrains Mono, monospace",
              letterSpacing: "0.1em", color: tab === t.id ? "#1d4ed8" : "#64748b",
              borderBottom: tab === t.id ? "2px solid #1d4ed8" : "2px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main style={{ padding: "24px" }}>
        {tab === "agents" && <AgentDashboard />}
        {tab === "tasks" && <TaskQueue />}
        {tab === "memory" && <MemoryViewer />}
        {tab === "events" && <EventLog />}
      </main>
    </div>
  );
}
