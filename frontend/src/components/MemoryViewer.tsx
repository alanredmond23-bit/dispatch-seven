// Cross-agent shared memory viewer

import { useState } from "react";
import { api } from "../lib/api";

type MemEntry = { key: string; value: unknown; agent: string; updated_at: string; expires_at: string | null };

export default function MemoryViewer() {
  const [key, setKey] = useState("");
  const [result, setResult] = useState<MemEntry | null>(null);
  const [error, setError] = useState("");

  const lookup = async () => {
    setError("");
    setResult(null);
    const data = await api.get(`/memory/${key}`).catch(() => null);
    if (!data) { setError(`Key "${key}" not found`); return; }
    setResult(data);
  };

  return (
    <div>
      <h2 style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "13px", letterSpacing: "0.15em", color: "#94a3b8", marginBottom: "20px" }}>
        SHARED MEMORY — dispatch7.memory
      </h2>
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        <input value={key} onChange={(e) => setKey(e.target.value)}
          placeholder="memory key..."
          style={{ flex: 1, background: "#0a0f1a", border: "1px solid #1e293b", color: "#e2e8f0",
            padding: "8px 12px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px" }} />
        <button onClick={lookup}
          style={{ background: "#1d4ed8", border: "none", color: "#fff", padding: "8px 20px",
            cursor: "pointer", fontFamily: "JetBrains Mono, monospace", fontSize: "12px" }}>
          FETCH
        </button>
      </div>
      {error && <p style={{ color: "#ef4444", fontFamily: "JetBrains Mono, monospace", fontSize: "12px" }}>{error}</p>}
      {result && (
        <div style={{ border: "1px solid #1e293b", padding: "16px", background: "#0a0f1a" }}>
          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#475569", marginBottom: "8px" }}>
            KEY: {result.key} | AGENT: {result.agent} | UPDATED: {new Date(result.updated_at).toLocaleString()}
            {result.expires_at && ` | EXPIRES: ${new Date(result.expires_at).toLocaleString()}`}
          </div>
          <pre style={{ color: "#e2e8f0", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(result.value, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
