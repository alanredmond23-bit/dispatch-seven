// DesignSystem.tsx — D7 component preview page.
// DEV ONLY: this page is only rendered when import.meta.env.DEV is true.
// Route: /design
// Shows: all design tokens, component variants, interactive states.

import { useState } from "react";
import { TypingIndicator } from "../components/TypingIndicator";
import { DarkModeToggle } from "../components/DarkModeToggle";
import { SetupWizard } from "../components/SetupWizard";
import CitationBlock, { parseMessageCitations } from "../components/CitationBlock";

// ── SECTION WRAPPER ───────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "var(--d7-space-12)" }}>
      <div style={{
        fontFamily: "var(--d7-font-mono)",
        fontSize: "9px",
        letterSpacing: "0.22em",
        color: "var(--d7-text-muted)",
        textTransform: "uppercase",
        paddingBottom: "var(--d7-space-3)",
        borderBottom: "1px solid var(--d7-border)",
        marginBottom: "var(--d7-space-6)",
      }}>
        {title}
      </div>
      {children}
    </section>
  );
}

// ── COLOR SWATCH ──────────────────────────────────────────────────────────────
function Swatch({ color, name, value }: { color: string; name: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--d7-space-2)" }}>
      <div style={{
        width: "100%",
        height: "48px",
        background: color,
        borderRadius: "var(--d7-radius)",
        border: "1px solid var(--d7-border)",
      }} />
      <div>
        <div style={{ fontFamily: "var(--d7-font-mono)", fontSize: "var(--d7-text-xs)", color: "var(--d7-text)" }}>{name}</div>
        <div style={{ fontFamily: "var(--d7-font-mono)", fontSize: "11px", color: "var(--d7-text-muted)" }}>{value}</div>
      </div>
    </div>
  );
}

// ── SAMPLE DATA ───────────────────────────────────────────────────────────────
const SAMPLE_CITATION_TEXT = `Here is legal analysis of the motion.

---
**CITATIONS**
- 18 U.S.C. § 1341 (Mail Fraud) ✓ — https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title18-section1341
- United States v. Skilling, 561 U.S. 358 (2010) ✓ — https://supreme.justia.com/cases/federal/us/561/358/
- Brady v. Maryland, 373 U.S. 83 (1963) [UNVERIFIED]
`;

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export function DesignSystem() {
  const [showWizard, setShowWizard] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  return (
    <div style={{
      maxWidth: "960px",
      margin: "0 auto",
      padding: "var(--d7-space-8) var(--d7-space-6)",
      minHeight: "100vh",
    }}>
      {/* Page header */}
      <div style={{ marginBottom: "var(--d7-space-12)" }}>
        <div style={{ fontFamily: "var(--d7-font-mono)", fontSize: "var(--d7-text-xs)", color: "var(--d7-accent)", letterSpacing: "0.22em", marginBottom: "var(--d7-space-2)" }}>
          DEV · DESIGN SYSTEM
        </div>
        <h1 style={{ fontSize: "var(--d7-text-2xl)", fontWeight: "var(--d7-weight-bold)", marginBottom: "var(--d7-space-3)" }}>
          Dispatch Seven
        </h1>
        <p style={{ color: "var(--d7-text-2)", fontSize: "var(--d7-text-md)" }}>
          Design System v1 — Geist · Dark-first · 4px grid
        </p>
      </div>

      {/* ── COLORS ── */}
      <Section title="Color Palette">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: "var(--d7-space-4)" }}>
          <Swatch color="#0A0A0F" name="Background"    value="#0A0A0F" />
          <Swatch color="#111118" name="Surface"       value="#111118" />
          <Swatch color="#16161F" name="Surface 2"     value="#16161F" />
          <Swatch color="#1E1E2E" name="Border"        value="#1E1E2E" />
          <Swatch color="#5B6EF5" name="Accent"        value="#5B6EF5" />
          <Swatch color="#7B8EFF" name="Accent Hover"  value="#7B8EFF" />
          <Swatch color="#22C55E" name="Success"       value="#22C55E" />
          <Swatch color="#F59E0B" name="Warning"       value="#F59E0B" />
          <Swatch color="#EF4444" name="Error"         value="#EF4444" />
          <Swatch color="#DC2626" name="Legal"         value="#DC2626" />
          <Swatch color="#F0F0F6" name="Text"          value="#F0F0F6" />
          <Swatch color="#8888AA" name="Text 2"        value="#8888AA" />
          <Swatch color="#55557A" name="Text Muted"    value="#55557A" />
        </div>
      </Section>

      {/* ── AGENT COLORS ── */}
      <Section title="Agent Domain Colors">
        <div style={{ display: "flex", gap: "var(--d7-space-3)", flexWrap: "wrap" }}>
          <span className="d7-badge d7-badge--legal">Legal</span>
          <span className="d7-badge d7-badge--code">Code</span>
          <span className="d7-badge d7-badge--research">Research</span>
          <span className="d7-badge d7-badge--orchestrator">Orchestrator</span>
          <span className="d7-badge d7-badge--muted">Unknown</span>
        </div>
      </Section>

      {/* ── TYPOGRAPHY ── */}
      <Section title="Typography — Geist">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--d7-space-4)" }}>
          {([
            ["var(--d7-text-2xl)", "700", "Heading / Wordmark"],
            ["var(--d7-text-xl)",  "600", "Section Heading"],
            ["var(--d7-text-lg)",  "600", "Card Title"],
            ["var(--d7-text-md)",  "500", "Body Large"],
            ["var(--d7-text-base)","400", "Body Default"],
            ["var(--d7-text-sm)", "400", "Body Small"],
            ["var(--d7-text-xs)", "400", "Caption / Micro"],
          ] as const).map(([size, weight, label]) => (
            <div key={label} style={{ display: "flex", alignItems: "baseline", gap: "var(--d7-space-4)" }}>
              <span style={{ minWidth: "180px", fontFamily: "var(--d7-font-mono)", fontSize: "11px", color: "var(--d7-text-muted)" }}>
                {label}
              </span>
              <span style={{ fontSize: size, fontWeight: weight }}>
                Dispatch Seven
              </span>
            </div>
          ))}
          <div style={{ marginTop: "var(--d7-space-4)", padding: "var(--d7-space-4)", background: "var(--d7-bg)", border: "1px solid var(--d7-border)", borderRadius: "var(--d7-radius)" }}>
            <div style={{ fontFamily: "var(--d7-font-mono)", fontSize: "var(--d7-text-xs)", color: "var(--d7-text-muted)", marginBottom: "var(--d7-space-2)" }}>GEIST MONO</div>
            <code style={{ fontFamily: "var(--d7-font-mono)", fontSize: "var(--d7-text-sm)", color: "var(--d7-text)" }}>
              const agent = await dispatch.run("legal", prompt);
            </code>
          </div>
        </div>
      </Section>

      {/* ── BUTTONS ── */}
      <Section title="Buttons">
        <div style={{ display: "flex", gap: "var(--d7-space-3)", flexWrap: "wrap", alignItems: "center", marginBottom: "var(--d7-space-4)" }}>
          <button className="d7-btn d7-btn-primary">Primary</button>
          <button className="d7-btn d7-btn-ghost">Ghost</button>
          <button className="d7-btn d7-btn-danger">Danger</button>
          <button className="d7-btn d7-btn-primary d7-btn-sm">Small Primary</button>
          <button className="d7-btn d7-btn-ghost d7-btn-sm">Small Ghost</button>
          <button className="d7-btn d7-btn-primary d7-btn-lg">Large</button>
          <button className="d7-btn d7-btn-primary" disabled>Disabled</button>
        </div>
        <div style={{ display: "flex", gap: "var(--d7-space-3)", flexWrap: "wrap", alignItems: "center" }}>
          <DarkModeToggle />
        </div>
      </Section>

      {/* ── INPUTS ── */}
      <Section title="Inputs">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--d7-space-4)", maxWidth: "400px" }}>
          <input className="d7-input" placeholder="Default input" />
          <input className="d7-input" placeholder="Focused input" autoFocus style={{ borderColor: "var(--d7-border-focus)", boxShadow: "0 0 0 3px var(--d7-accent-glow)" }} />
          <textarea className="d7-input d7-textarea" placeholder="Textarea" />
        </div>
      </Section>

      {/* ── CARDS ── */}
      <Section title="Task Cards">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--d7-space-3)", maxWidth: "480px" }}>
          {([
            ["pending",  "Build vector index for Five9 call logs", "M2 Legal Pipeline · p1"],
            ["running",  "Running Franks motion suppression analysis", "Active · 12s elapsed"],
            ["done",     "Voyage AI API key configured", "Completed 14m ago"],
            ["failed",   "SBA discovery response — server timeout", "Retry available"],
            ["legal",    "5:24-CR-00376 · Pretrial motions deadline", "Sep 1 2026 · 79 days"],
          ] as const).map(([status, title, meta]) => (
            <div key={status} className={`d7-card d7-card--${status}`}>
              <div style={{ fontSize: "var(--d7-text-base)", fontWeight: "var(--d7-weight-semibold)", marginBottom: "var(--d7-space-1)" }}>
                {title}
              </div>
              <div style={{ fontSize: "var(--d7-text-xs)", color: "var(--d7-text-2)", fontFamily: "var(--d7-font-mono)" }}>
                {meta}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── CODE BLOCK ── */}
      <Section title="Code Block">
        <pre className="d7-code-block" style={{ maxWidth: "600px" }}>
{`// Agent dispatch result
const result = {
  agent:     "legal/franks",
  status:    "complete",
  cost_usd:  0.0047,
  tokens:    { in: 1240, out: 380 },
  citations: ["18 U.S.C. § 2511", "Franks v. Delaware"],
};`}
        </pre>
        <br />
        <pre className="d7-code-block d7-code-block--legal" style={{ maxWidth: "600px" }}>
{`⚠ LEGAL RED ZONE — 5:24-cr-00376
No production assertions without verified citations.
Fifth Amendment reserved on all act-of-production requests.`}
        </pre>
      </Section>

      {/* ── MESSAGES ── */}
      <Section title="Message Bubbles">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--d7-space-3)", maxWidth: "560px" }}>
          {/* Agent message */}
          <div className="d7-message d7-message--agent">
            <div className="d7-message__icon" style={{ background: "var(--d7-agent-muted, var(--d7-surface-2))", border: "1px solid var(--d7-agent-legal)", color: "var(--d7-agent-legal)" }}>L</div>
            <div className="d7-message__bubble">
              <div style={{ fontSize: "var(--d7-text-xs)", fontFamily: "var(--d7-font-mono)", color: "var(--d7-text-muted)", marginBottom: "var(--d7-space-1)" }}>LEGAL AGENT</div>
              Franks motion viable. Affiant overstated Five9 data confidence. Suppression hearing recommended before Sept 14 trial.
              <CitationBlock messageText={SAMPLE_CITATION_TEXT} />
            </div>
          </div>
          {/* User message */}
          <div className="d7-message d7-message--user">
            <div className="d7-message__icon" style={{ background: "var(--d7-accent-muted)", border: "1px solid var(--d7-accent)", color: "var(--d7-accent)" }}>A</div>
            <div className="d7-message__bubble">Draft the Franks motion. Cite Five9 discrepancy in paragraph 3.</div>
          </div>
          {/* Typing indicator */}
          <div className="d7-message d7-message--agent">
            <div className="d7-message__icon" style={{ background: "var(--d7-surface-2)", border: "1px solid var(--d7-border-2)", color: "var(--d7-text-muted)" }}>O</div>
            <div className="d7-message__bubble">
              <div style={{ fontSize: "var(--d7-text-xs)", fontFamily: "var(--d7-font-mono)", color: "var(--d7-text-muted)", marginBottom: "var(--d7-space-1)" }}>ORCHESTRATOR</div>
              <TypingIndicator isTyping={true} />
            </div>
          </div>
        </div>
        <div style={{ marginTop: "var(--d7-space-4)", display: "flex", gap: "var(--d7-space-3)", alignItems: "center" }}>
          <button
            className="d7-btn d7-btn-ghost d7-btn-sm"
            onClick={() => setIsTyping(t => !t)}
          >
            {isTyping ? "Stop" : "Start"} typing
          </button>
          <TypingIndicator isTyping={isTyping} />
        </div>
      </Section>

      {/* ── COST BAR ── */}
      <Section title="Cost Bar">
        <div style={{ maxWidth: "400px", display: "flex", flexDirection: "column", gap: "var(--d7-space-4)" }}>
          {([
            [15, "$0.0015"],
            [42, "$0.0420"],
            [78, "$0.0780"],
          ] as const).map(([pct, label]) => (
            <div key={pct}>
              <div className="d7-cost-bar">
                <div className="d7-cost-bar__fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="d7-cost-bar__label">{label} / $0.10 session budget ({pct}%)</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── SETUP WIZARD ── */}
      <Section title="Setup Wizard">
        <button className="d7-btn d7-btn-primary" onClick={() => setShowWizard(true)}>
          Launch Setup Wizard
        </button>
        {showWizard && (
          <SetupWizard
            onComplete={data => { console.log("Setup complete", data); setShowWizard(false); }}
            onDismiss={() => setShowWizard(false)}
          />
        )}
      </Section>

      {/* ── DIVIDERS ── */}
      <Section title="Dividers">
        <hr className="d7-divider" />
        <div style={{ padding: "var(--d7-space-2) 0", color: "var(--d7-text-muted)", fontSize: "var(--d7-text-xs)" }}>
          ↑ default · ↓ subtle
        </div>
        <hr className="d7-divider d7-divider--subtle" />
      </Section>

      {/* Footer */}
      <div style={{
        paddingTop: "var(--d7-space-8)",
        borderTop: "1px solid var(--d7-border)",
        fontFamily: "var(--d7-font-mono)",
        fontSize: "var(--d7-text-xs)",
        color: "var(--d7-text-muted)",
        letterSpacing: "0.12em",
      }}>
        D7 DESIGN SYSTEM v1 · DEV BUILD · {new Date().toISOString().slice(0, 10)}
      </div>
    </div>
  );
}
