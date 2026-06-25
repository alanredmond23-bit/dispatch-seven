// Agent event audit log — read-only view of dispatch7.events

import { useEffect, useState } from "react";

type Event = { id: string; agent: string; action: string; payload: unknown; created_at: string };

export default function EventLog() {
  const [events] = useState<Event[]>([]);

  useEffect(() => {
    // Will wire to /api/v1/events once backend route is built (M1)
    // For now: static placeholder demonstrating the schema
  }, []);

  return (
    <div>
      <h2 style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "13px", letterSpacing: "0.15em", color: "#94a3b8", marginBottom: "20px" }}>
        EVENT LOG — dispatch7.events
      </h2>
      {events.length === 0 ? (
        <div style={{ border: "1px solid #1e293b", padding: "24px", background: "#0a0f1a", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#334155" }}>
          AWAITING EVENTS — agents must ping /api/v1/agents/:id/ping to register
        </div>
      ) : events.map((e) => (
        <div key={e.id} style={{ border: "1px solid #1e293b", padding: "12px 16px", marginBottom: "4px", background: "#0a0f1a", fontFamily: "JetBrains Mono, monospace", fontSize: "11px" }}>
          <span style={{ color: "#1d4ed8", marginRight: "12px" }}>{e.agent}</span>
          <span style={{ color: "#94a3b8", marginRight: "12px" }}>{e.action}</span>
          <span style={{ color: "#334155" }}>{new Date(e.created_at).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
