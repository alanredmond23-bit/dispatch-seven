import CostBar from "./components/CostBar";
import TaskGraph from "./components/TaskGraph";
import type { GraphTask } from "./components/TaskGraph";
import { useDecompose } from "./hooks/useDecompose";
import { useState, useEffect, useCallback, useRef } from "react";
import DarkModeToggle from "./components/DarkModeToggle";
import SetupWizard from "./components/SetupWizard";
import TypingIndicator from "./components/TypingIndicator";
import { useAgentStream } from "./hooks/useAgentStream";
import { generateScheduleViaWs } from "./lib/wsSchedule";
import CitationBlock, { parseMessageCitations } from "./components/CitationBlock";
import { DesignSystem } from "./pages/DesignSystem";
import Dashboard from "./pages/Dashboard";  // T10: multi-panel agent dashboard
import "./index.css";

import ActionsPanel from "./components/ActionsPanel";
import ConnectionBadge from "./components/ConnectionBadge";
import { useAgentStream } from "./hooks/useAgentStream";

// ── CONFIG ───────────────────────────────────────────────────────────────────
const OWNER = "alanredmond23-bit";
const REPO  = "dispatch-seven";
const GH    = "https://api.github.com";
const TODAY = "2026-06-25";

const COURT_DATES = [
  { id:"trial",  label:"FEDERAL TRIAL",      case:"5:24-cr-00376", date:"2026-09-14", p:"p0", note:"Judge Schmehl · Gateway Bldg Suite 518 · Reading PA" },
  { id:"m0",     label:"M0 — Pre-Build",     case:null,            date:"2026-07-07", p:"p0", note:"Voyage AI key + Supabase schema + ACA env" },
  { id:"m1",     label:"M1 — Swarm",         case:null,            date:"2026-07-21", p:"p1", note:"12-agent orchestration live" },
  { id:"m2",     label:"M2 — Legal Pipeline",case:null,            date:"2026-08-11", p:"p1", note:"Five9 indexed · Franks record built" },
  { id:"m3",     label:"M3 — Trial Ready",   case:null,            date:"2026-09-01", p:"p1", note:"All 12 agents operational" },
];

// ── DESIGN TOKENS ────────────────────────────────────────────────────────────
const T = {
  bg:     "#050810",
  surf:   "#090e1a",
  surf2:  "#0d1425",
  border: "#1a2540",
  blue:   "#1d4ed8",
  red:    "#dc2626",
  gold:   "#d97706",
  green:  "#16a34a",
  purple: "#7c3aed",
  muted:  "#4a5568",
  sub:    "#2d3748",
  text:   "#e2e8f0",
  dim:    "#1a2540",
  mono:   "'JetBrains Mono', 'Fira Code', monospace",
  sans:   "'Inter', system-ui, sans-serif",
};

const PC = { p0:"#dc2626", p1:"#d97706", p2:"#3b82f6", "p0-critical":"#dc2626", "p1-high":"#d97706", "p2-useful":"#3b82f6" };
const TYPE_C = { legal:"#dc2626", build:"#1d4ed8", admin:"#4a5568", personal:"#16a34a", finance:"#7c3aed" };

// ── UTILS ────────────────────────────────────────────────────────────────────
function daysUntil(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const now = new Date(TODAY + "T12:00:00Z");
  return Math.ceil((d - now) / 86400000);
}

function urgencyColor(days) {
  if (days <= 2)  return "#dc2626";
  if (days <= 7)  return "#f87171";
  if (days <= 30) return "#d97706";
  if (days <= 60) return "#3b82f6";
  return T.muted;
}

function getPriority(labels = []) {
  const names = labels.map(l => l.name || l);
  if (names.includes("p0-critical")) return "p0";
  if (names.includes("p1-high"))     return "p1";
  if (names.includes("p2-useful"))   return "p2";
  return "p2";
}

// ── GITHUB API ───────────────────────────────────────────────────────────────
async function ghFetch(method, path, body, token) {
  const res = await fetch(`${GH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || res.status);
  return data;
}

const gh = {
  get:   (p, t)    => ghFetch("GET",   p, null, t),
  post:  (p, b, t) => ghFetch("POST",  p, b,    t),
  patch: (p, b, t) => ghFetch("PATCH", p, b,    t),
};

// ── CLAUDE SCHEDULE ──────────────────────────────────────────────────────────
async function generateSchedule(issues, sessionId?: string) {
  const p0 = issues.filter(i => getPriority(i.labels) === "p0").slice(0, 6);
  const p1 = issues.filter(i => getPriority(i.labels) === "p1").slice(0, 5);
  const trialDays = daysUntil("2026-09-14");
  const m0Days    = daysUntil("2026-07-07");

  const prompt = `You are D7 SCHEDULER for Alan Redmond. Today is Thursday ${TODAY}.

CONTEXT:
- Federal trial 5:24-cr-00376 in ${trialDays} days (Sep 14 2026, Judge Schmehl)
- M0 Pre-Build deadline in ${m0Days} days (Jul 7)
- Sole P0 blocker: Voyage AI API key (free signup at voyageai.com, 10 minutes)
- Alan operates via voice dictation from Wyomissing PA
- Shannon handles physical court filings

OPEN P0 ISSUES:
${p0.length ? p0.map(i => `- ${i.title}`).join("\n") : "None"}

OPEN P1 ISSUES:
${p1.length ? p1.map(i => `- ${i.title}`).join("\n") : "None"}

Generate a realistic time-blocked day. Morning = legal/high-focus. Afternoon = build/admin.
Return ONLY valid JSON array, no markdown, no explanation:
[{"time":"9:00 AM","duration":"45m","task":"...","type":"legal|build|admin|personal|finance","note":"one tactical sentence"}]
Max 8 blocks. Reference actual issue titles. Be specific, not generic.`;

  try {
    // Use WebSocket transport — backend proxies to Anthropic with streaming
    // session_id scopes the WS connection to this schedule request
    const sessionId = `schedule-${Date.now()}`;
    const text = await generateScheduleViaWs(prompt, sessionId);
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (err) {
    console.error("[generateSchedule] WS error:", err);
    return null;
  }
}

// ── SHARED STYLES ─────────────────────────────────────────────────────────────
const css = {
  card: {
    background: T.surf,
    border: `1px solid ${T.border}`,
    padding: "14px 16px",
    marginBottom: "8px",
  },
  label: {
    fontFamily: T.mono,
    fontSize: "9px",
    letterSpacing: "0.18em",
    color: T.muted,
    marginBottom: "6px",
    textTransform: "uppercase",
  },
  btn: {
    background: "none",
    border: `1px solid ${T.border}`,
    color: T.muted,
    padding: "6px 12px",
    cursor: "pointer",
    fontFamily: T.mono,
    fontSize: "10px",
    letterSpacing: "0.1em",
  },
};

// ── TOKEN SCREEN ─────────────────────────────────────────────────────────────
function TokenScreen({ onSave }) {
  const [tok, setTok] = useState("");

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", justifyContent:"center", alignItems:"center", padding:"32px 24px" }}>
      <div style={{ marginBottom:"48px", textAlign:"center" }}>
        <div style={{ fontFamily:T.mono, fontSize:"32px", color:T.blue, letterSpacing:"0.2em", fontWeight:700, lineHeight:1 }}>D7</div>
        <div style={{ fontFamily:T.mono, fontSize:"10px", color:T.muted, letterSpacing:"0.25em", marginTop:"6px" }}>DISPATCH SEVEN · COMMAND</div>
      </div>

      <div style={{ width:"100%", maxWidth:"320px" }}>
        <div style={css.label}>GITHUB TOKEN (ghp_...)</div>
        <input
          type="password"
          value={tok}
          onChange={e => setTok(e.target.value)}
          onKeyDown={e => e.key === "Enter" && tok && onSave(tok)}
          placeholder="Paste token here"
          autoFocus
          style={{ width:"100%", boxSizing:"border-box", background:T.surf, border:`1px solid ${T.border}`, color:T.text, padding:"13px 14px", fontFamily:T.mono, fontSize:"13px", outline:"none", marginBottom:"12px" }}
        />
        <button
          onClick={() => tok && onSave(tok)}
          style={{ width:"100%", background:T.blue, border:"none", color:"#fff", padding:"14px", fontFamily:T.mono, fontSize:"11px", letterSpacing:"0.15em", cursor:"pointer" }}
        >
          CONNECT →
        </button>
        <div style={{ fontFamily:T.mono, fontSize:"9px", color:T.muted, textAlign:"center", marginTop:"12px", letterSpacing:"0.1em" }}>
          TOKEN LIVES IN SESSION ONLY · NOT STORED
        </div>
      </div>
    </div>
  );
}

// ── TODAY TAB ─────────────────────────────────────────────────────────────────
function TodayTab({ issues, sessionId }: { issues: any[]; sessionId?: string }) {
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const { isTyping, run: streamRun } = useAgentStream();

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const blocks = await generateSchedule(issues, sessionId);
      setSchedule(blocks);
    } catch(e) {
      setError("Schedule failed. Check network.");
      setSchedule([]);
    }
    setLoading(false);
  }, [issues]);

  useEffect(() => { run(); }, []);

  const alerts = COURT_DATES.filter(d => daysUntil(d.date) <= 2);
  const trialDays = daysUntil("2026-09-14");

  return (
    <div style={{ padding:"16px 16px 90px" }}>

      {/* 48hr alerts */}
      {alerts.map(a => (
        <div key={a.id} style={{ background:"#2d0a0a", border:"1px solid #dc2626", padding:"10px 14px", marginBottom:"8px" }}>
          <span style={{ fontFamily:T.mono, fontSize:"9px", color:"#dc2626", letterSpacing:"0.2em" }}>⚠ 48H ALERT  </span>
          <span style={{ fontFamily:T.mono, fontSize:"11px", color:T.text }}>{a.label}</span>
        </div>
      ))}

      {/* Trial countdown hero */}
      <div style={{ background:"#150505", border:"1px solid #3f0a0a", borderLeft:"3px solid #dc2626", padding:"18px 20px", marginBottom:"16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontFamily:T.mono, fontSize:"9px", color:"#dc2626", letterSpacing:"0.2em", marginBottom:"4px" }}>5:24-CR-00376 · TRIAL</div>
          <div style={{ fontFamily:T.mono, fontSize:"10px", color:T.muted }}>SEP 14 2026 · JUDGE SCHMEHL</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontFamily:T.mono, fontSize:"42px", color:trialDays <= 30 ? "#dc2626" : T.text, fontWeight:700, lineHeight:1 }}>{trialDays}</div>
          <div style={{ fontFamily:T.mono, fontSize:"9px", color:T.muted, letterSpacing:"0.15em" }}>DAYS</div>
        </div>
      </div>

      {/* Schedule header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px" }}>
        <div style={css.label}>TODAY'S PLAN — {TODAY}</div>
        <button onClick={run} style={{ ...css.btn, fontSize:"9px" }}>{loading ? "..." : "↻ REGEN"}</button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ ...css.card, textAlign:"center" }}>
          <div style={{ fontFamily:T.mono, fontSize:"11px", color:T.muted, letterSpacing:"0.1em" }}>
            D7 SCHEDULER RUNNING...
          </div>
          <div style={{ fontFamily:T.mono, fontSize:"10px", color:T.sub, marginTop:"6px" }}>
            Reading {issues.length} open issues
          </div>
        </div>
      )}

      {/* Schedule blocks */}
      {!loading && schedule && schedule.map((b, i) => (
        <div key={i} style={{ ...css.card, display:"flex", gap:"14px", alignItems:"flex-start" }}>
          <div style={{ minWidth:"56px" }}>
            <div style={{ fontFamily:T.mono, fontSize:"11px", color:T.blue, lineHeight:1.3 }}>{b.time}</div>
            <div style={{ fontFamily:T.mono, fontSize:"9px", color:T.muted, marginTop:"2px" }}>{b.duration}</div>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:"13px", color:T.text, lineHeight:1.4, marginBottom:"3px" }}>{b.task}</div>
            {b.note && <div style={{ fontFamily:T.mono, fontSize:"10px", color:T.muted, lineHeight:1.4 }}>{parseMessageCitations(b.note).body || b.note}</div>}
            {b.note && parseMessageCitations(b.note).noneExtracted && <CitationBlock messageText={b.note} />}
            {b.note && parseMessageCitations(b.note).citations.length > 0 && <CitationBlock messageText={b.note} />}
          </div>
          <div style={{ fontFamily:T.mono, fontSize:"9px", color:TYPE_C[b.type] || T.muted, letterSpacing:"0.12em", paddingTop:"2px", flexShrink:0 }}>
            {(b.type||"").toUpperCase()}
          </div>
        </div>
      ))}

      <TypingIndicator visible={isTyping || loading} />

      {!loading && schedule?.length === 0 && (
        <div style={{ ...css.card, fontFamily:T.mono, fontSize:"11px", color:T.muted }}>
          {error || "No schedule — add issues to the board first."}
        </div>
      )}

      {/* Open P0 summary */}
      {issues.filter(i => getPriority(i.labels) === "p0").length > 0 && (
        <div style={{ marginTop:"20px" }}>
          <div style={css.label}>OPEN P0 BLOCKERS</div>
          {issues.filter(i => getPriority(i.labels) === "p0").map(i => (
            <div key={i.number} style={{ ...css.card, borderLeft:"2px solid #dc2626", padding:"10px 14px" }}>
              <div style={{ fontFamily:T.mono, fontSize:"11px", color:"#dc2626", marginBottom:"2px" }}>#{i.number}</div>
              <div style={{ fontSize:"13px", color:T.text }}>{i.title}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── BOARD TAB ─────────────────────────────────────────────────────────────────
function BoardTab({ issues, onDone, loading }) {
  const [closing, setClosing] = useState(new Set());

  const handleDone = async (num) => {
    setClosing(s => new Set([...s, num]));
    await onDone(num);
    setClosing(s => { const n = new Set(s); n.delete(num); return n; });
  };

  // Group by milestone
  const groups = {};
  const MS_ORDER = ["M0 — Pre-Build","M1 — Swarm Foundation","M1 — Swarm","M2 — Legal Pipeline","M3 — Trial Ready","Backlog"];

  issues.forEach(i => {
    const ms = i.milestone?.title || "Backlog";
    const key = MS_ORDER.find(m => ms.startsWith(m.split(" — ")[0])) || ms;
    if (!groups[key]) groups[key] = [];
    groups[key].push(i);
  });

  const keys = [...new Set([...MS_ORDER.filter(m => groups[m]), ...Object.keys(groups)])];

  return (
    <div style={{ padding:"16px 16px 90px" }}>
      {loading && (
        <div style={{ fontFamily:T.mono, fontSize:"9px", color:T.muted, letterSpacing:"0.15em", marginBottom:"12px" }}>
          SYNCING GITHUB...
        </div>
      )}
      {issues.length === 0 && !loading && (
        <div style={{ ...css.card, fontFamily:T.mono, fontSize:"12px", color:T.muted }}>All clear. No open issues.</div>
      )}

      {keys.map(key => {
        const group = groups[key];
        if (!group?.length) return null;
        const deadline = COURT_DATES.find(d => d.label.startsWith(key.split(" — ")[0]));
        const days = deadline ? daysUntil(deadline.date) : null;

        return (
          <div key={key} style={{ marginBottom:"24px" }}>
            {/* Milestone header */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px", paddingBottom:"8px", borderBottom:`1px solid ${T.border}` }}>
              <div style={{ fontFamily:T.mono, fontSize:"9px", color:T.muted, letterSpacing:"0.18em" }}>
                {key.toUpperCase()}
              </div>
              {days !== null && (
                <div style={{ fontFamily:T.mono, fontSize:"11px", color:urgencyColor(days), letterSpacing:"0.05em" }}>
                  {days}d
                </div>
              )}
            </div>

            {/* Issues */}
            {group.map(issue => {
              const p   = getPriority(issue.labels);
              const isC = closing.has(issue.number);
              const agentLabels = issue.labels?.filter(l => l.name?.startsWith("agent:")).map(l => l.name.replace("agent:","")) || [];

              return (
                <div key={issue.number} style={{ ...css.card, display:"flex", alignItems:"flex-start", gap:"10px", opacity: isC ? 0.4 : 1, transition:"opacity 0.3s" }}>
                  {/* Priority stripe */}
                  <div style={{ width:"3px", alignSelf:"stretch", background: PC[p] || T.border, flexShrink:0, borderRadius:"2px" }} />

                  {/* Content */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:"13px", color:T.text, lineHeight:1.4, marginBottom:"4px", wordBreak:"break-word" }}>
                      {issue.title}
                    </div>
                    <div style={{ fontFamily:T.mono, fontSize:"9px", color:T.muted, display:"flex", gap:"8px", flexWrap:"wrap" }}>
                      <span>#{issue.number}</span>
                      <span style={{ color: PC[p] || T.muted }}>{p.toUpperCase()}</span>
                      {agentLabels.map(a => <span key={a} style={{ color:T.sub }}>→{a.toUpperCase()}</span>)}
                    </div>
                  </div>

                  {/* Done button */}
                  <button
                    onClick={() => handleDone(issue.number)}
                    disabled={isC}
                    style={{ ...css.btn, color: isC ? T.muted : T.green, borderColor: isC ? T.border : T.green, flexShrink:0, padding:"7px 10px" }}
                  >
                    {isC ? "..." : "DONE"}
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── CAPTURE TAB ───────────────────────────────────────────────────────────────
function CaptureTab({ token, onCreated, sessionId, onDecompose }) {
  const [title,      setTitle]      = useState("");
  const [priority,   setPriority]   = useState("p1-high");
  const [domain,     setDomain]     = useState("DEVOPS");
  const [note,       setNote]       = useState("");
  const [listening,  setListening]  = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status,     setStatus]     = useState(null);
  const recRef = useRef(null);
  // T4c: auto-decompose multi-step goals before submitting to WS
  const { maybeDecompose, decomposing } = useDecompose(sessionId ?? "capture");

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setStatus({ ok:false, msg:"Voice not supported — type it" }); return; }
    const rec = new SR();
    rec.continuous        = false;
    rec.interimResults    = false;
    rec.lang              = "en-GB";
    rec.onstart  = ()  => setListening(true);
    rec.onresult = (e) => setTitle(e.results[0][0].transcript);
    rec.onend    = ()  => setListening(false);
    rec.onerror  = ()  => { setListening(false); setStatus({ ok:false, msg:"Voice error — type it" }); };
    recRef.current = rec;
    rec.start();
  };

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    setStatus(null);
    // T4c: if title looks multi-step, decompose before creating the issue
    const combinedGoal = note ? `${title.trim()}\n${note}` : title.trim();
    const decomposed = await maybeDecompose(combinedGoal);
    if (decomposed) onDecompose?.(decomposed);
    try {
      const agentLabel = domain === "FED" ? "agent:legal" : domain === "FINANCE" ? "agent:finance" : "agent:build";
      const issue = await gh.post(
        `/repos/${OWNER}/${REPO}/issues`,
        {
          title: title.trim(),
          labels: [priority, agentLabel],
          body: `**Domain:** ${domain}\n**Created via:** D7 Mobile Command\n\n${note || ""}`.trim(),
        },
        token
      );
      setStatus({ ok:true, msg:`Created #${issue.number} — ${issue.title.slice(0,40)}` });
      setTitle(""); setNote("");
      onCreated();
    } catch(e) {
      setStatus({ ok:false, msg:`Failed: ${e.message}` });
    }
    setSubmitting(false);
  };

  const domainColor = (d) => domain === d ? T.blue : T.surf2;
  const pColor      = (p) => priority === p ? PC[p] || T.blue : T.surf2;

  return (
    <div style={{ padding:"16px 16px 90px" }}>
      <div style={css.label}>QUICK CAPTURE</div>

      {/* Voice button */}
      <button
        onClick={startVoice}
        style={{ width:"100%", background: listening ? "#2d0a0a" : T.surf, border:`1px solid ${listening ? "#dc2626" : T.border}`, color: listening ? "#dc2626" : T.muted, padding:"18px", cursor:"pointer", fontFamily:T.mono, fontSize:"11px", letterSpacing:"0.18em", marginBottom:"12px", transition:"all 0.2s" }}
      >
        {listening ? "● LISTENING..." : "⊕ VOICE INPUT"}
      </button>

      {/* Title */}
      <textarea
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Task title..."
        rows={2}
        style={{ width:"100%", boxSizing:"border-box", background:T.surf, border:`1px solid ${title ? T.blue : T.border}`, color:T.text, padding:"12px 14px", fontFamily:T.sans, fontSize:"14px", resize:"none", outline:"none", marginBottom:"12px", transition:"border-color 0.2s" }}
      />

      {/* Note */}
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Optional context..."
        rows={2}
        style={{ width:"100%", boxSizing:"border-box", background:T.surf, border:`1px solid ${T.border}`, color:T.text, padding:"10px 14px", fontFamily:T.sans, fontSize:"13px", resize:"none", outline:"none", marginBottom:"16px" }}
      />

      {/* Priority */}
      <div style={css.label}>PRIORITY</div>
      <div style={{ display:"flex", gap:"8px", marginBottom:"16px" }}>
        {[["p0-critical","P0"],["p1-high","P1"],["p2-useful","P2"]].map(([p,lbl]) => (
          <button key={p} onClick={() => setPriority(p)}
            style={{ flex:1, background: pColor(p), border:`1px solid ${priority===p ? PC[p] : T.border}`, color: priority===p ? "#fff" : T.muted, padding:"10px 4px", cursor:"pointer", fontFamily:T.mono, fontSize:"11px", letterSpacing:"0.12em", transition:"all 0.15s" }}>
            {lbl}
          </button>
        ))}
      </div>

      {/* Domain */}
      <div style={css.label}>DOMAIN</div>
      <div style={{ display:"flex", gap:"8px", marginBottom:"24px", flexWrap:"wrap" }}>
        {["FED","DEVOPS","FINANCE","PERSONAL"].map(d => (
          <button key={d} onClick={() => setDomain(d)}
            style={{ flex:"1 1 60px", background: domainColor(d), border:`1px solid ${domain===d ? T.blue : T.border}`, color: domain===d ? "#fff" : T.muted, padding:"10px 6px", cursor:"pointer", fontFamily:T.mono, fontSize:"10px", letterSpacing:"0.12em", transition:"all 0.15s" }}>
            {d}
          </button>
        ))}
      </div>

      {/* Submit */}
      <button
        onClick={submit}
        disabled={!title.trim() || submitting}
        style={{ width:"100%", background: title.trim() ? T.blue : T.dim, border:"none", color:"#fff", padding:"15px", cursor: title.trim() ? "pointer" : "default", fontFamily:T.mono, fontSize:"11px", letterSpacing:"0.15em", opacity: submitting ? 0.7 : 1, transition:"all 0.2s" }}
      >
        {submitting ? "CREATING..." : "CREATE ISSUE →"}
      </button>

      {status && (
        <div style={{ fontFamily:T.mono, fontSize:"11px", color: status.ok ? T.green : "#dc2626", marginTop:"14px", textAlign:"center", lineHeight:1.4 }}>
          {status.msg}
        </div>
      )}
    </div>
  );
}

// ── DEADLINES TAB ─────────────────────────────────────────────────────────────
function DeadlinesTab() {
  const trialDays = daysUntil("2026-09-14");

  return (
    <div style={{ padding:"16px 16px 90px" }}>

      {/* Trial hero */}
      <div style={{ background:"#0d0303", border:"2px solid #7f1d1d", padding:"28px 24px", marginBottom:"20px", textAlign:"center" }}>
        <div style={{ fontFamily:T.mono, fontSize:"9px", color:"#b91c1c", letterSpacing:"0.25em", marginBottom:"10px" }}>
          FEDERAL TRIAL · 5:24-CR-00376
        </div>
        <div style={{ fontFamily:T.mono, fontSize:"64px", color: trialDays <= 30 ? "#dc2626" : T.text, fontWeight:700, lineHeight:1, letterSpacing:"-0.02em" }}>
          {trialDays}
        </div>
        <div style={{ fontFamily:T.mono, fontSize:"10px", color:"#b91c1c", letterSpacing:"0.2em", marginTop:"8px" }}>
          DAYS · SEP 14 2026
        </div>
        <div style={{ fontFamily:T.mono, fontSize:"9px", color:T.muted, marginTop:"10px", lineHeight:1.6 }}>
          JUDGE SCHMEHL · EDPA READING<br/>GATEWAY BLDG SUITE 518
        </div>
      </div>

      {/* Milestone deadlines */}
      <div style={css.label}>MILESTONES</div>
      {COURT_DATES.slice(1).map(d => {
        const days = daysUntil(d.date);
        const color = urgencyColor(days);
        return (
          <div key={d.id} style={{ ...css.card, display:"flex", justifyContent:"space-between", alignItems:"center", borderLeft:`2px solid ${color}` }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:T.mono, fontSize:"11px", color:T.text, marginBottom:"3px" }}>{d.label}</div>
              <div style={{ fontFamily:T.mono, fontSize:"9px", color:T.muted, lineHeight:1.4 }}>{d.note}</div>
              <div style={{ fontFamily:T.mono, fontSize:"9px", color:T.sub, marginTop:"3px" }}>{d.date}</div>
            </div>
            <div style={{ textAlign:"right", flexShrink:0, marginLeft:"16px" }}>
              <div style={{ fontFamily:T.mono, fontSize:"26px", color, fontWeight:700, lineHeight:1 }}>{days}</div>
              <div style={{ fontFamily:T.mono, fontSize:"9px", color:T.muted, letterSpacing:"0.1em" }}>DAYS</div>
            </div>
          </div>
        );
      })}

      {/* Standing rules */}
      <div style={{ marginTop:"20px" }}>
        <div style={css.label}>STANDING RULES</div>
        <div style={{ ...css.card, fontFamily:T.mono, fontSize:"10px", color:T.muted, lineHeight:1.8 }}>
          <span style={{ color:"#dc2626" }}>REBER RULE</span> — Never name pretrial services in any filing<br/>
          <span style={{ color:"#dc2626" }}>5TH AMEND</span> — Reserve on all production questions<br/>
          <span style={{ color:"#d97706" }}>SERVE READY</span> — Mail Cornerstone + joel@cornerstonelaw.us<br/>
          <span style={{ color:"#d97706" }}>FILE ADDR</span> — 2 High Road, Wyomissing PA 19610<br/>
          <span style={{ color:T.muted }}>KRAFT</span> — 3 copies, 504 W Hamilton Rm 1601, confirm 484-663-4433
        </div>
      </div>
    </div>
  );
}

// ── HEADER ────────────────────────────────────────────────────────────────────
function Header({ issueCount, trialDays, onRefresh, loading, sessionId, wsStatus = "open", reconnectAttempts = 0, dailyTotal = null }) {
  return (
    <div style={{ background:T.bg, borderBottom:`1px solid ${T.border}`, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, zIndex:10 }}>
      <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
        <span style={{ fontFamily:T.mono, fontSize:"15px", color:T.blue, fontWeight:700, letterSpacing:"0.2em" }}>D7</span>
        <span style={{ fontFamily:T.mono, fontSize:"10px", color:T.muted, letterSpacing:"0.12em" }}>COMMAND</span>
        {issueCount > 0 && (
          <span style={{ fontFamily:T.mono, fontSize:"9px", background:T.surf, border:`1px solid ${T.border}`, color:T.muted, padding:"2px 7px" }}>
            {issueCount} OPEN
          </span>
        )}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
        <DarkModeToggle />
        <CostBadge sessionId={sessionId} />
        {dailyTotal != null && (
          <span style={{ fontFamily:T.mono, fontSize:"9px", color:T.muted, letterSpacing:"0.08em", whiteSpace:"nowrap" }}>
            Today: ${dailyTotal.toFixed(2)}
          </span>
        )}
        <ConnectionBadge status={wsStatus} attempts={reconnectAttempts} />
        <span style={{ fontFamily:T.mono, fontSize:"11px", color: trialDays <= 30 ? "#dc2626" : T.muted, letterSpacing:"0.1em" }}>
          {trialDays}d
        </span>
        <button onClick={onRefresh} style={{ ...css.btn, fontSize:"9px", padding:"4px 8px" }}>
          {loading ? "..." : "↻"}
        </button>
      </div>
    </div>
  );
}

// ── BOTTOM NAV ────────────────────────────────────────────────────────────────
function BottomNav({ tab, setTab, p0Count }) {
  const TABS = [
    { id:"today",     label:"TODAY",   icon:"◈" },
    { id:"board",     label:"BOARD",   icon:"▦", badge: p0Count },
    { id:"capture",   label:"+",       icon:null },
    { id:"deadlines", label:"DATES",   icon:"⊠" },
  ];

  return (
    <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:"430px", background:T.bg, borderTop:`1px solid ${T.border}`, display:"flex", zIndex:10 }}>
      {TABS.map(t => (
        <button key={t.id} onClick={() => setTab(t.id)}
          style={{
            flex:1, background:"none", border:"none",
            borderTop: `2px solid ${tab === t.id ? T.blue : "transparent"}`,
            color: tab === t.id ? T.blue : T.muted,
            padding: t.id === "capture" ? "10px 4px 12px" : "12px 4px 14px",
            cursor:"pointer", fontFamily:T.mono, fontSize: t.id === "capture" ? "22px" : "9px",
            letterSpacing:"0.12em", position:"relative", transition:"color 0.15s",
          }}
        >
          {t.id === "capture"
            ? <span style={{ display:"flex", alignItems:"center", justifyContent:"center", width:"32px", height:"32px", background: tab==="capture" ? T.blue : T.surf, border:`1px solid ${tab==="capture" ? T.blue : T.border}`, borderRadius:"50%", margin:"0 auto", fontSize:"18px", color: tab==="capture" ? "#fff" : T.muted }}>+</span>
            : t.label
          }
          {t.badge > 0 && (
            <span style={{ position:"absolute", top:"8px", right:"8px", background:"#dc2626", color:"#fff", fontFamily:T.mono, fontSize:"8px", padding:"1px 5px", borderRadius:"10px", lineHeight:"1.4" }}>
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {

  // /dashboard — agent session dashboard (production + dev)
  if (typeof window !== "undefined" && window.location.pathname === "/dashboard") {
    return <Dashboard />;
  }

  // DEV-only: route /design to design system preview
  if (import.meta.env.DEV && typeof window !== "undefined" && window.location.pathname === "/design") {
    return <DesignSystem />;
  }

  const [token,   setToken]   = useState(import.meta.env.VITE_GITHUB_TOKEN ?? "");
  const [tab,     setTab]     = useState("today");
  const [issues,  setIssues]  = useState([]);
  const [loading, setLoading] = useState(false);
  // Stable session ID for cost tracking — new value per page load, no persistence needed
  const sessionId = useRef(typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2)).current;
  // T3c/T3d: daily cost + budget state, fed by CostBar via onSummary callback
  const [dailyTotal,  setDailyTotal]  = useState<number | null>(null);
  const [budgetPct,   setBudgetPct]   = useState<number>(0);
  const [budgetModal, setBudgetModal] = useState(false);
  const [graphTasks,  setGraphTasks]  = useState<GraphTask[] | null>(null);

  const handleSummary = useCallback((s: { daily_total_usd: number; budget_pct: number }) => {
    setDailyTotal(s.daily_total_usd);
    if (s.budget_pct >= 100 && !budgetModal) setBudgetModal(true);
    setBudgetPct(s.budget_pct);
  }, [budgetModal]);

  const handleNewSession = () => {
    // Clear session by reloading — sessionId is page-scoped, so reload creates new one
    window.location.reload();
  };

  const handleOverrideBudget = async () => {
    try {
      await fetch("/api/v1/runs/override-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
    } catch { /* non-critical */ }
    setBudgetModal(false);
  };
  // WS stream — exposes connection status for ConnectionBadge
  const { wsStatus, reconnectAttempts } = useAgentStream(sessionId);

  const fetchIssues = useCallback(async (tok = token) => {
    if (!tok) return;
    setLoading(true);
    try {
      const data = await gh.get(`/repos/${OWNER}/${REPO}/issues?state=open&per_page=100`, tok);
      setIssues(Array.isArray(data) ? data : []);
    } catch {
      setIssues([]);
    }
    setLoading(false);
  }, [token]);

  const handleConnect = (tok) => {
    setToken(tok);
    fetchIssues(tok);
  };

  const markDone = useCallback(async (num) => {
    setIssues(prev => prev.filter(i => i.number !== num));
    try {
      await gh.patch(`/repos/${OWNER}/${REPO}/issues/${num}`, { state:"closed" }, token);
    } catch {
      fetchIssues();
    }
  }, [token]);

  if (!token) return <TokenScreen onSave={handleConnect} />;

  const p0Count = issues.filter(i => getPriority(i.labels) === "p0").length;
  const trialDays = daysUntil("2026-09-14");

  return (
    <div style={{ background:T.bg, minHeight:"100vh", maxWidth:"430px", margin:"0 auto", position:"relative", fontFamily:T.sans, color:T.text }}>
      <Header issueCount={issues.length} trialDays={trialDays} onRefresh={() => fetchIssues()} loading={loading} sessionId={sessionId} dailyTotal={dailyTotal} />

      {/* T3b: CostBar below header */}
      <CostBar sessionId={sessionId} onSummary={handleSummary} />

      {/* T4b: TaskGraph shown when decomposition exists */}
      {graphTasks && (
        <div style={{ padding:"8px 16px 0" }}>
          <div style={{ fontFamily:"'JetBrains Mono','Fira Code',monospace", fontSize:"9px", color:"#3b82f6", letterSpacing:"0.16em", marginBottom:"6px" }}>
            MULTI-STEP TASK DETECTED — DECOMPOSING...
          </div>
          <TaskGraph sessionId={sessionId} initialTasks={graphTasks} onDismiss={() => setGraphTasks(null)} />
        </div>
      )}

      {/* T3d: Budget modal */}
      {budgetModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(5,8,16,0.88)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:"24px" }}>
          <div style={{ background:"#090e1a", border:"1px solid #dc2626", padding:"28px 24px", maxWidth:"340px", width:"100%" }}>
            <div style={{ fontFamily:"'JetBrains Mono','Fira Code',monospace", fontSize:"10px", color:"#dc2626", letterSpacing:"0.18em", marginBottom:"14px" }}>
              BUDGET REACHED
            </div>
            <div style={{ fontFamily:"'Inter',system-ui,sans-serif", fontSize:"14px", color:"#e2e8f0", lineHeight:1.5, marginBottom:"24px" }}>
              Session budget reached (${(budgetPct / 100 * 1).toFixed(2)}). Start a new session or continue with overage.
            </div>
            <div style={{ display:"flex", gap:"10px" }}>
              <button onClick={handleNewSession}
                style={{ flex:1, background:"#1d4ed8", border:"none", color:"#fff", padding:"12px", cursor:"pointer", fontFamily:"'JetBrains Mono','Fira Code',monospace", fontSize:"10px", letterSpacing:"0.12em" }}>
                NEW SESSION
              </button>
              <button onClick={handleOverrideBudget}
                style={{ flex:1, background:"none", border:"1px solid #4a5568", color:"#4a5568", padding:"12px", cursor:"pointer", fontFamily:"'JetBrains Mono','Fira Code',monospace", fontSize:"10px", letterSpacing:"0.12em" }}>
                CONTINUE
              </button>
            </div>
          </div>
        </div>
      )}
      <Header issueCount={issues.length} trialDays={trialDays} onRefresh={() => fetchIssues()} loading={loading} sessionId={sessionId} wsStatus={wsStatus} reconnectAttempts={reconnectAttempts} />

      {tab === "today"     && <TodayTab     issues={issues} sessionId={sessionId} />}
      {tab === "board"     && <BoardTab     issues={issues} onDone={markDone} loading={loading} />}
      {tab === "capture"   && <CaptureTab   token={token}   onCreated={fetchIssues} sessionId={sessionId} onDecompose={setGraphTasks} />}
      {tab === "deadlines" && <DeadlinesTab />}

      <ActionsPanel sessionId={sessionId} />
      <BottomNav tab={tab} setTab={setTab} p0Count={p0Count} />
    </div>
  );
}
