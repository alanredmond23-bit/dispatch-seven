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
      </div>
    </div>
  );
}

export default SetupWizard;
