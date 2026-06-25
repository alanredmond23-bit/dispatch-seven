// Task queue — create, view, and assign tasks to agents

import { useState, useEffect } from "react";
import { api } from "../lib/api";

type Task = { id: string; title: string; assignee: string; priority: string; status: string; domain: string; created_at: string };

export default function TaskQueue() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState("open");

  useEffect(() => {
    api.get(`/tasks?status=${filter}`).then((d) => setTasks(d.tasks || []));
  }, [filter]);

  const close = async (id: string) => {
    await api.patch(`/tasks/${id}`, { status: "done" });
    setTasks((t) => t.filter((x) => x.id !== id));
  };

  const priorityColor: Record<string, string> = { "p0": "#ef4444", "p1": "#f59e0b", "p2": "#3b82f6" };

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        {["open","in_progress","done"].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ background: filter === s ? "#1d4ed8" : "transparent", border: "1px solid #1e293b",
              color: filter === s ? "#fff" : "#64748b", padding: "6px 14px", cursor: "pointer",
              fontFamily: "JetBrains Mono, monospace", fontSize: "11px", letterSpacing: "0.08em" }}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {tasks.map((t) => (
          <div key={t.id} style={{ border: "1px solid #1e293b", padding: "14px 16px", background: "#0a0f1a", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", marginBottom: "4px" }}>{t.title}</div>
              <div style={{ fontSize: "11px", color: "#475569" }}>
                <span style={{ color: priorityColor[t.priority] || "#64748b", marginRight: "10px" }}>{t.priority?.toUpperCase()}</span>
                <span style={{ marginRight: "10px" }}>{t.assignee}</span>
                <span>{t.domain}</span>
              </div>
            </div>
            {filter === "open" && (
              <button onClick={() => close(t.id)}
                style={{ background: "none", border: "1px solid #1e293b", color: "#22c55e",
                  cursor: "pointer", padding: "4px 10px", fontFamily: "JetBrains Mono, monospace", fontSize: "10px" }}>
                DONE
              </button>
            )}
          </div>
        ))}
        {tasks.length === 0 && <p style={{ color: "#334155", fontFamily: "JetBrains Mono, monospace", fontSize: "12px" }}>NO TASKS — {filter.toUpperCase()}</p>}
      </div>
    </div>
  );
}
