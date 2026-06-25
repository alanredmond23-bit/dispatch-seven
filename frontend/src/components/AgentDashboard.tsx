// 12-Agent swarm status dashboard
// Polls /api/v1/agents every 5s

import { useState, useEffect } from "react";
import { api } from "../lib/api";

const AGENT_COLORS: Record<string, string> = {
  ORCHESTRATOR: "#1d4ed8", LEGAL: "#b91c1c", DISCOVERY: "#7c3aed",
  FINANCE: "#047857", BUILD: "#0369a1", QA: "#b45309",
  RESEARCH: "#0891b2", COMMS: "#6d28d9", MEMORY: "#be185d",
  MONITOR: "#0f766e", SCHEDULER: "#a21caf", EXECUTE: "#1d4ed8",
};

type Agent = { name: string; status: string; last_ping: string };

export default function AgentDashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const ALL_AGENTS = [
    "ORCHESTRATOR","LEGAL","DISCOVERY","FINANCE",
    "BUILD","QA","RESEARCH","COMMS",
    "MEMORY","MONITOR","SCHEDULER","EXECUTE"
  ];

  useEffect(() => {
    const fetch = () =>
      api.get("/agents")
        .then((d) => setAgents(d.agents || []))
        .finally(() => setLoading(false));
    fetch();
    const interval = setInterval(fetch, 5000);
    return () => clearInterval(interval);
  }, []);

  const getAgent = (name: string) =>
    agents.find((a) => a.name === name);

  if (loading) return <p style={{ color: "#475569", fontFamily: "JetBrains Mono, monospace" }}>LOADING AGENTS...</p>;

  return (
    <div>
      <h2 style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "13px", letterSpacing: "0.15em", color: "#94a3b8", marginBottom: "20px" }}>
        AGENT SWARM — {ALL_AGENTS.length} NODES
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
        {ALL_AGENTS.map((name) => {
          const agent = getAgent(name);
          const isActive = agent?.status === "active";
          const color = AGENT_COLORS[name] || "#1d4ed8";
          return (
            <div key={name} style={{
              border: `1px solid ${isActive ? color : "#1e293b"}`,
              padding: "16px", background: "#0a0f1a",
            }}>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color, marginBottom: "8px" }}>
                {name}
              </div>
              <div style={{ fontSize: "11px", color: isActive ? "#22c55e" : "#475569" }}>
                {isActive ? "● ACTIVE" : "○ IDLE"}
              </div>
              {agent?.last_ping && (
                <div style={{ fontSize: "10px", color: "#334155", marginTop: "4px" }}>
                  {new Date(agent.last_ping).toLocaleTimeString()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
