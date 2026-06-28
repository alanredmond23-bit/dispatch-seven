// SetupWizard — full-screen onboarding overlay.
// Uses D7 design system: dark overlay, backdrop-blur, accent buttons, progress dots.
// Steps: GitHub Token → Select Repo → Confirm → Done

import { useState } from "react";

interface SetupStep {
  title: string;
  subtitle: string;
  content: (props: StepProps) => React.ReactNode;
}

interface StepProps {
  onNext: (data?: Record<string, string>) => void;
  onBack: () => void;
  data: Record<string, string>;
}

const steps: SetupStep[] = [
  {
    title: "Connect GitHub",
    subtitle: "D7 reads your issues and milestones to build your daily plan.",
    content: ({ onNext, data }) => {
      const [token, setToken] = useState(data.token ?? "");
      return (
        <>
          <div className="d7-label" style={{ marginBottom: "var(--d7-space-1)" }}>
            GITHUB TOKEN (ghp_...)
          </div>
          <input
            type="password"
            className="d7-input"
            value={token}
            onChange={e => setToken(e.target.value)}
            onKeyDown={e => e.key === "Enter" && token && onNext({ token })}
            placeholder="Paste your personal access token"
            autoFocus
            style={{ marginBottom: "var(--d7-space-4)" }}
          />
          <p style={{ fontSize: "var(--d7-text-xs)", color: "var(--d7-text-muted)", marginBottom: "var(--d7-space-4)", fontFamily: "var(--d7-font-mono)", lineHeight: "var(--d7-leading-normal)" }}>
            Token lives in session memory only — never stored.
            Needs: repo:read, issues:read/write.
          </p>
          <button
            className="d7-btn d7-btn-primary"
            style={{ width: "100%" }}
            onClick={() => token && onNext({ token })}
            disabled={!token}
          >
            CONNECT →
          </button>
        </>
      );
    },
  },
  {
    title: "Select Repository",
    subtitle: "Which repo holds your milestone board?",
    content: ({ onNext, onBack, data }) => {
      const [repo, setRepo] = useState(data.repo ?? "alanredmond23-bit/dispatch-seven");
      return (
        <>
          <div className="d7-label" style={{ marginBottom: "var(--d7-space-1)" }}>
            OWNER/REPO
          </div>
          <input
            type="text"
            className="d7-input"
            value={repo}
            onChange={e => setRepo(e.target.value)}
            onKeyDown={e => e.key === "Enter" && repo && onNext({ repo })}
            placeholder="owner/repository"
            autoFocus
            style={{ marginBottom: "var(--d7-space-4)" }}
          />
          <div style={{ display: "flex", gap: "var(--d7-space-3)" }}>
            <button className="d7-btn d7-btn-ghost" style={{ flex: 1 }} onClick={onBack}>← BACK</button>
            <button className="d7-btn d7-btn-primary" style={{ flex: 2 }} onClick={() => repo && onNext({ repo })} disabled={!repo}>
              CONFIRM →
            </button>
          </div>
        </>
      );
    },
  },
  {
    title: "Ready",
    subtitle: "D7 is configured and ready to build your command center.",
    content: ({ onNext }) => (
      <>
        <div style={{
          background: "var(--d7-success-muted)",
          border: "1px solid var(--d7-success)",
          borderRadius: "var(--d7-radius)",
          padding: "var(--d7-space-4)",
          textAlign: "center",
          marginBottom: "var(--d7-space-6)",
        }}>
          <div style={{ fontSize: "var(--d7-text-xl)", marginBottom: "var(--d7-space-2)" }}>✓</div>
          <div style={{ fontFamily: "var(--d7-font-mono)", fontSize: "var(--d7-text-sm)", color: "var(--d7-success)" }}>
            CONNECTED
          </div>
        </div>
        <button className="d7-btn d7-btn-primary" style={{ width: "100%" }} onClick={() => onNext()}>
          LAUNCH D7 →
        </button>
      </>
    ),
  },
];

interface SetupWizardProps {
  onComplete: (data: Record<string, string>) => void;
  onDismiss?: () => void;
}

export function SetupWizard({ onComplete, onDismiss }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<Record<string, string>>({});

  const handleNext = (stepData?: Record<string, string>) => {
    const merged = { ...data, ...stepData };
    setData(merged);
    if (step < steps.length - 1) {
      setStep(s => s + 1);
    } else {
      onComplete(merged);
    }
  };

  const handleBack = () => setStep(s => Math.max(0, s - 1));

  const current = steps[step];

  return (
    <div className="d7-wizard-overlay" onClick={e => e.target === e.currentTarget && onDismiss?.()}>
      <div className="d7-wizard-card">
        {/* Progress dots */}
        <div className="d7-wizard-dots">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`d7-wizard-dot ${i === step ? "d7-wizard-dot--active" : ""} ${i < step ? "d7-wizard-dot--complete" : ""}`}
            />
          ))}
        </div>

        {/* Step header */}
        <div style={{ marginBottom: "var(--d7-space-6)" }}>
          <div style={{ fontFamily: "var(--d7-font-mono)", fontSize: "var(--d7-text-xs)", color: "var(--d7-text-muted)", letterSpacing: "var(--d7-tracking-widest)", marginBottom: "var(--d7-space-2)" }}>
            STEP {step + 1} OF {steps.length}
          </div>
          <h2 style={{ fontSize: "var(--d7-text-lg)", fontWeight: "var(--d7-weight-semibold)", marginBottom: "var(--d7-space-2)" }}>
            {current.title}
          </h2>
          <p style={{ fontSize: "var(--d7-text-sm)", color: "var(--d7-text-2)", lineHeight: "var(--d7-leading-snug)" }}>
            {current.subtitle}
          </p>
        </div>

        {/* Step content */}
        {current.content({ onNext: handleNext, onBack: handleBack, data })}
// SetupWizard.tsx — 3-step first-run modal
// Ponytail: localStorage only, CSS transitions, no animation library
import { useState, useEffect } from "react";
const DOMAINS = ["Legal", "Finance", "Research", "Build", "General"] as const;
type Domain = typeof DOMAINS[number];
function useWizard() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // Show if no workspace configured yet
    if (!localStorage.getItem("d7_workspace")) {
      setOpen(true);
  }, []);
  const complete = () => setOpen(false);
  return { open, complete };
export default function SetupWizard() {
  const { open, complete } = useWizard();
  const [step, setStep]       = useState(0);
  const [workspace, setWs]    = useState("");
  const [domain, setDomain]   = useState<Domain | "">("");
  if (!open) return null;
  const save = () => {
    localStorage.setItem("d7_workspace", workspace.trim() || "My Workspace");
    if (domain) localStorage.setItem("d7_domain", domain);
    complete();
  const steps = [
    // Step 0
    <div key={0}>
      <div style={s.label}>NAME YOUR WORKSPACE</div>
      <input
        autoFocus
        value={workspace}
        onChange={e => setWs(e.target.value)}
        onKeyDown={e => e.key === "Enter" && workspace.trim() && setStep(1)}
        placeholder="e.g. Redmond Command"
        style={s.input}
      />
      <button
        onClick={() => workspace.trim() && setStep(1)}
        disabled={!workspace.trim()}
        style={{ ...s.btn, opacity: workspace.trim() ? 1 : 0.5 }}
      >
        NEXT →
      </button>
    </div>,
    // Step 1
    <div key={1}>
      <div style={s.label}>PRIMARY DOMAIN</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "20px" }}>
        {DOMAINS.map(d => (
          <label key={d} style={{ ...s.radio, borderColor: domain === d ? "#1d4ed8" : "#1a2540", background: domain === d ? "#0a1428" : "#090e1a" }}>
            <input
              type="radio"
              name="domain"
              value={d}
              checked={domain === d}
              onChange={() => setDomain(d)}
              style={{ accentColor: "#1d4ed8" }}
            <span style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: "13px", color: "#e2e8f0" }}>{d}</span>
          </label>
        ))}
      </div>
      <button
        onClick={() => domain && setStep(2)}
        disabled={!domain}
        style={{ ...s.btn, opacity: domain ? 1 : 0.5 }}
      >
        NEXT →
      </button>
    </div>,
    // Step 2
    <div key={2} style={{ textAlign: "center" }}>
      <div style={{ fontSize: "32px", marginBottom: "16px" }}>⚡</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", color: "#e2e8f0", marginBottom: "8px" }}>
        Your D7 workspace is live.
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: "#4a5568", marginBottom: "28px" }}>
        Your first agent is ready.
      </div>
      <button onClick={save} style={s.btn}>START →</button>
    </div>,
  ];
    <div style={s.overlay}>
      <div style={s.card}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px" }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "18px", color: "#1d4ed8", fontWeight: 700, letterSpacing: "0.2em" }}>D7</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: "#4a5568", letterSpacing: "0.2em", marginTop: "2px" }}>SETUP</div>
          {/* Step dots */}
          <div style={{ display: "flex", gap: "6px" }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: "8px", height: "8px", borderRadius: "50%", background: i <= step ? "#1d4ed8" : "#1a2540", transition: "background 0.2s" }} />
            ))}
        {/* Step content — CSS transition via key change */}
        <div style={{ transition: "opacity 0.2s", opacity: 1 }}>
          {steps[step]}
      </div>
    </div>
  );
}

// ── Scoped styles (inline to avoid global pollution) ─────────────────────────
const s = {
  overlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(5, 8, 16, 0.92)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    padding: "24px",
  },
  card: {
    background: "#090e1a",
    border: "1px solid #1a2540",
    padding: "28px 24px",
    width: "100%",
    maxWidth: "400px",
    borderRadius: "4px",
  },
  label: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "9px",
    color: "#4a5568",
    letterSpacing: "0.2em",
    marginBottom: "12px",
  },
  input: {
    width: "100%",
    background: "#050810",
    border: "1px solid #1a2540",
    color: "#e2e8f0",
    padding: "12px 14px",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: "14px",
    outline: "none",
    marginBottom: "16px",
    borderRadius: "2px",
  } as React.CSSProperties,
  btn: {
    width: "100%",
    background: "#1d4ed8",
    border: "none",
    color: "#fff",
    padding: "13px",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "11px",
    letterSpacing: "0.15em",
    cursor: "pointer",
    borderRadius: "2px",
  } as React.CSSProperties,
  radio: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 14px",
    border: "1px solid #1a2540",
    cursor: "pointer",
    borderRadius: "2px",
    transition: "border-color 0.15s, background 0.15s",
  } as React.CSSProperties,
};
