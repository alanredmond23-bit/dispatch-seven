// Settings.tsx — D7 provider + model configuration per agent
// Route: /settings (dev-only route, same pattern as /design)
// Saves to localStorage key "d7-agent-settings" (session config, not persisted to Supabase yet)
// Ponytail: Phase 2 will sync to Supabase settings table for multi-device persistence.

import { useState, useEffect } from "react";

type Provider = "anthropic" | "openai" | "groq" | "ollama";

const AGENTS = ["LEGAL", "CODE", "RESEARCH", "SCHEDULER", "ORCHESTRATOR"] as const;
type AgentDomain = typeof AGENTS[number];

const DEFAULT_MODELS: Record<AgentDomain, string> = {
  LEGAL:        "claude-sonnet-4-6",
  CODE:         "claude-sonnet-4-6",
  RESEARCH:     "claude-sonnet-4-6",
  SCHEDULER:    "claude-haiku-4-5-20251001",
  ORCHESTRATOR: "claude-sonnet-4-6",
};

const PROVIDER_MODELS: Record<Provider, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
  openai:    ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  groq:      ["llama3-70b-8192", "llama3-8b-8192", "mixtral-8x7b-32768", "gemma2-9b-it"],
  ollama:    ["llama3", "llama3:70b", "mistral", "codellama", "phi3"],
};

interface AgentSetting {
  provider: Provider;
  model: string;
}

type AgentSettings = Record<AgentDomain, AgentSetting>;

const STORAGE_KEY = "d7-agent-settings";

function loadSettings(): AgentSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return Object.fromEntries(
    AGENTS.map((a) => [a, { provider: "anthropic" as Provider, model: DEFAULT_MODELS[a] }])
  ) as AgentSettings;
}

const T = {
  bg:     "#050810",
  surf:   "#090e1a",
  surf2:  "#0d1425",
  border: "#1a2540",
  blue:   "#1d4ed8",
  muted:  "#4a5568",
  text:   "#e2e8f0",
  mono:   "'JetBrains Mono', 'Fira Code', monospace",
  green:  "#16a34a",
};

const PROVIDER_COLORS: Record<Provider, string> = {
  anthropic: "#d97706",
  openai:    "#10a37f",
  groq:      "#f55036",
  ollama:    "#7c3aed",
};

export function Settings() {
  const [settings, setSettings] = useState<AgentSettings>(loadSettings);
  const [globalProvider, setGlobalProvider] = useState<Provider>("anthropic");
  const [openAIBaseURL, setOpenAIBaseURL] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY + "-global");
    if (raw) {
      try {
        const g = JSON.parse(raw);
        if (g.defaultProvider) setGlobalProvider(g.defaultProvider);
        if (g.openAIBaseURL)   setOpenAIBaseURL(g.openAIBaseURL);
      } catch { /* ignore */ }
    }
  }, []);

  const updateAgent = (agent: AgentDomain, field: keyof AgentSetting, value: string) => {
    setSettings((prev) => {
      const next = { ...prev, [agent]: { ...prev[agent], [field]: value } };
      // Reset model to provider default when provider changes
      if (field === "provider") {
        const models = PROVIDER_MODELS[value as Provider];
        next[agent].model = models[0];
      }
      return next;
    });
  };

  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    localStorage.setItem(STORAGE_KEY + "-global", JSON.stringify({ defaultProvider: globalProvider, openAIBaseURL }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const showBaseURL = globalProvider === "openai" || globalProvider === "ollama" ||
    Object.values(settings).some((s) => s.provider === "openai" || s.provider === "ollama");

  return (
    <div style={{ background: T.bg, minHeight: "100vh", padding: "24px 16px", fontFamily: T.mono }}>
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <div style={{ fontSize: "10px", color: T.muted, letterSpacing: "0.25em", marginBottom: "6px" }}>
          D7 / SETTINGS
        </div>
        <div style={{ fontSize: "18px", color: T.text, fontWeight: 700, letterSpacing: "0.08em" }}>
          PROVIDER ROUTING
        </div>
        <div style={{ fontSize: "10px", color: T.muted, marginTop: "6px", lineHeight: 1.6 }}>
          Configure provider and model per agent. LiteLLM proxy on port 8082 is now deprecated.
        </div>
      </div>

      {/* Global default */}
      <div style={{ background: T.surf, border: `1px solid ${T.border}`, padding: "16px", marginBottom: "24px" }}>
        <div style={{ fontSize: "9px", color: T.muted, letterSpacing: "0.2em", marginBottom: "12px" }}>
          GLOBAL DEFAULT PROVIDER
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
          {(["anthropic", "openai", "groq", "ollama"] as Provider[]).map((p) => (
            <button
              key={p}
              onClick={() => setGlobalProvider(p)}
              style={{
                background: globalProvider === p ? PROVIDER_COLORS[p] : T.surf2,
                border: `1px solid ${globalProvider === p ? PROVIDER_COLORS[p] : T.border}`,
                color: globalProvider === p ? "#fff" : T.muted,
                padding: "8px 14px",
                cursor: "pointer",
                fontFamily: T.mono,
                fontSize: "10px",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <div style={{ fontSize: "9px", color: T.muted, lineHeight: 1.6 }}>
          Priority: per-agent override → this default → DEFAULT_PROVIDER env → anthropic
        </div>
      </div>

      {/* OpenAI Base URL — visible when any OpenAI/Ollama provider is selected */}
      {showBaseURL && (
        <div style={{ background: T.surf, border: `1px solid ${T.border}`, padding: "16px", marginBottom: "24px" }}>
          <div style={{ fontSize: "9px", color: T.muted, letterSpacing: "0.2em", marginBottom: "8px" }}>
            OPENAI BASE URL
          </div>
          <input
            type="text"
            value={openAIBaseURL}
            onChange={(e) => setOpenAIBaseURL(e.target.value)}
            placeholder="https://your-proxy.com/v1 (blank = SDK default)"
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: T.surf2,
              border: `1px solid ${T.border}`,
              color: T.text,
              padding: "10px 12px",
              fontFamily: T.mono,
              fontSize: "11px",
              outline: "none",
            }}
          />
          <div style={{ fontSize: "9px", color: T.muted, marginTop: "6px" }}>
            Applies to OpenAI provider. Ollama uses OLLAMA_BASE_URL env var.
          </div>
        </div>
      )}

      {/* Per-agent settings */}
      <div style={{ fontSize: "9px", color: T.muted, letterSpacing: "0.2em", marginBottom: "12px" }}>
        PER-AGENT OVERRIDES
      </div>
      {AGENTS.map((agent) => {
        const setting = settings[agent];
        const models  = PROVIDER_MODELS[setting.provider];
        return (
          <div key={agent} style={{ background: T.surf, border: `1px solid ${T.border}`, padding: "14px 16px", marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <div style={{ fontSize: "11px", color: T.text, letterSpacing: "0.12em" }}>{agent}</div>
              <div style={{
                fontSize: "9px",
                color: PROVIDER_COLORS[setting.provider],
                letterSpacing: "0.15em",
              }}>
                {setting.provider.toUpperCase()}
              </div>
            </div>

            {/* Provider selector */}
            <div style={{ display: "flex", gap: "6px", marginBottom: "10px", flexWrap: "wrap" }}>
              {(["anthropic", "openai", "groq", "ollama"] as Provider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => updateAgent(agent, "provider", p)}
                  style={{
                    background: setting.provider === p ? PROVIDER_COLORS[p] : T.surf2,
                    border: `1px solid ${setting.provider === p ? PROVIDER_COLORS[p] : T.border}`,
                    color: setting.provider === p ? "#fff" : T.muted,
                    padding: "5px 10px",
                    cursor: "pointer",
                    fontFamily: T.mono,
                    fontSize: "9px",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Model dropdown */}
            <select
              value={setting.model}
              onChange={(e) => updateAgent(agent, "model", e.target.value)}
              style={{
                width: "100%",
                background: T.surf2,
                border: `1px solid ${T.border}`,
                color: T.text,
                padding: "8px 10px",
                fontFamily: T.mono,
                fontSize: "10px",
                outline: "none",
                cursor: "pointer",
              }}
            >
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              <option value={setting.model}>{setting.model}</option>
            </select>
          </div>
        );
      })}

      {/* Save */}
      <button
        onClick={save}
        style={{
          width: "100%",
          background: saved ? T.green : T.blue,
          border: "none",
          color: "#fff",
          padding: "14px",
          cursor: "pointer",
          fontFamily: T.mono,
          fontSize: "11px",
          letterSpacing: "0.15em",
          marginTop: "16px",
          transition: "background 0.2s",
        }}
      >
        {saved ? "SAVED ✓" : "SAVE SETTINGS"}
      </button>
      <div style={{ fontSize: "9px", color: T.muted, textAlign: "center", marginTop: "8px", lineHeight: 1.6 }}>
        Saved to session. Phase 2: sync to Supabase for persistence across devices.
      </div>
    </div>
  );
}
