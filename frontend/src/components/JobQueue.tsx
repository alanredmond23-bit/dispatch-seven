// JobQueue.tsx — Turn 9: active + recent Inngest job list
// Props: { sessionId?: string }
// Polls GET /api/v1/jobs?session_id=X every 10s for job list,
// then polls /api/v1/jobs/status/:job_id to refresh active jobs.
// Trigger buttons allow manual dispatch of research, summary, deadline_sweep jobs.
// Mobile-first: full-width cards stacked. Desktop: same cards in wider container.

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────
type JobStatus = "queued" | "running" | "completed" | "failed";
type JobType   = "research" | "summary" | "deadline_sweep";

interface Job {
  job_id:     string;
  type:       JobType;
  session_id: string | null;
  status:     JobStatus;
  elapsed_ms: number;
  result:     Record<string, unknown> | null;
  error:      string | null;
  created_at: string;
  updated_at: string;
}

interface TriggerModalState {
  type: JobType;
  query?: string;   // for research
}

// ── Constants ─────────────────────────────────────────────────────────────────
const MONO = "'JetBrains Mono','Fira Code',monospace";
const SANS = "'Inter',system-ui,sans-serif";
const POLL_MS = 10_000;

const STATUS_COLOR: Record<JobStatus, string> = {
  queued:    "#d97706",
  running:   "#3b82f6",
  completed: "#16a34a",
  failed:    "#dc2626",
};

const STATUS_ICON: Record<JobStatus, string> = {
  queued:    "○",
  running:   "▶",
  completed: "✓",
  failed:    "✗",
};

const TYPE_LABEL: Record<JobType, string> = {
  research:       "RESEARCH",
  summary:        "SUMMARY",
  deadline_sweep: "DEADLINE SWEEP",
};

const TYPE_COLOR: Record<JobType, string> = {
  research:       "#0891b2",
  summary:        "#7c3aed",
  deadline_sweep: "#b91c1c",
};

function fmtElapsed(ms: number): string {
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// ── Component ─────────────────────────────────────────────────────────────────
interface JobQueueProps {
  sessionId?: string;
}

export default function JobQueue({ sessionId }: JobQueueProps) {
  const [jobs, setJobs]             = useState<Job[]>([]);
  const [loading, setLoading]       = useState(true);
  const [modal, setModal]           = useState<TriggerModalState | null>(null);
  const [triggerInput, setTriggerInput] = useState("");
  const [triggering, setTriggering] = useState(false);
  const abortRef                    = useRef<AbortController | null>(null);

  // Fetch job list
  const loadJobs = useCallback(async () => {
    try {
      const path = sessionId ? `/jobs?session_id=${encodeURIComponent(sessionId)}&limit=20` : "/jobs?limit=20";
      const data: { jobs: Job[] } = await api.get(path);
      setJobs(data.jobs ?? []);
    } catch {
      // Non-critical — keep showing last known state
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Refresh a single active job in-place (avoids full list refetch on every tick)
  const refreshActiveJobs = useCallback(async (currentJobs: Job[]) => {
    const active = currentJobs.filter((j) => j.status === "queued" || j.status === "running");
    if (active.length === 0) return;

    const updated = await Promise.allSettled(
      active.map(async (j): Promise<Job> => {
        const data: Job = await api.get(`/jobs/status/${j.job_id}`);
        return data;
      })
    );

    setJobs((prev) => {
      const patch = new Map<string, Job>();
      for (const r of updated) {
        if (r.status === "fulfilled") patch.set(r.value.job_id, r.value);
      }
      return prev.map((j) => patch.get(j.job_id) ?? j);
    });
  }, []);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(() => {
      loadJobs();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [loadJobs]);

  // Also refresh active jobs more aggressively while any are running
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === "queued" || j.status === "running");
    if (!hasActive) return;

    const interval = setInterval(() => refreshActiveJobs(jobs), 3_000);
    return () => clearInterval(interval);
  }, [jobs, refreshActiveJobs]);

  // Trigger a new job
  const handleTrigger = useCallback(async () => {
    if (!modal) return;
    setTriggering(true);

    try {
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const payload: Record<string, unknown> = {
        session_id: sessionId ?? "manual",
      };

      if (modal.type === "research") {
        if (!triggerInput.trim()) {
          alert("Enter a search query");
          return;
        }
        payload.query = triggerInput.trim();
      }

      const result: { job_id: string; status: string } = await api.post("/jobs/trigger", {
        type: modal.type,
        payload,
      });

      // Prepend new job to list optimistically
      const newJob: Job = {
        job_id:     result.job_id,
        type:       modal.type,
        session_id: sessionId ?? null,
        status:     "queued",
        elapsed_ms: 0,
        result:     null,
        error:      null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      setJobs((prev) => [newJob, ...prev].slice(0, 20));
      setModal(null);
      setTriggerInput("");
    } catch (e) {
      console.error("[JobQueue] trigger error:", e);
    } finally {
      setTriggering(false);
    }
  }, [modal, sessionId, triggerInput]);

  if (loading) {
    return (
      <div style={{ fontFamily: MONO, fontSize: "11px", color: "#4a5568", padding: "12px" }}>
        LOADING JOBS...
      </div>
    );
  }

  return (
    <div style={{ width: "100%", fontFamily: MONO }}>
      {/* Header + trigger buttons */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "8px",
        marginBottom: "12px",
      }}>
        <div style={{ fontSize: "9px", letterSpacing: "0.2em", color: "#94a3b8", textTransform: "uppercase" }}>
          JOB QUEUE {jobs.length > 0 && `— ${jobs.length}`}
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {(["research", "summary", "deadline_sweep"] as JobType[]).map((t) => (
            <button
              key={t}
              onClick={() => { setModal({ type: t }); setTriggerInput(""); }}
              style={{
                background: "none",
                border: `1px solid ${TYPE_COLOR[t]}`,
                color: TYPE_COLOR[t],
                padding: "4px 8px",
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: "9px",
                letterSpacing: "0.12em",
              }}
            >
              + {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Job cards */}
      {jobs.length === 0 ? (
        <div style={{ fontSize: "11px", color: "#334155", padding: "12px 0" }}>
          No jobs yet — trigger one above.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {jobs.map((job) => (
            <div
              key={job.job_id}
              style={{
                background: "#0a0f1a",
                border: `1px solid ${job.status === "failed" ? "#dc2626" : "#1e293b"}`,
                padding: "12px 14px",
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: "4px 12px",
                alignItems: "start",
              }}
            >
              {/* Left: type + status */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "9px", color: TYPE_COLOR[job.type], letterSpacing: "0.14em" }}>
                    {TYPE_LABEL[job.type]}
                  </span>
                  <span style={{ fontSize: "9px", color: STATUS_COLOR[job.status] }}>
                    {STATUS_ICON[job.status]} {job.status.toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: "10px", color: "#4a5568", fontFamily: SANS }}>
                  {job.session_id ?? "no session"} · {fmtElapsed(job.elapsed_ms)}
                </div>
                {job.error && (
                  <div style={{ fontSize: "10px", color: "#dc2626", marginTop: "4px", fontFamily: SANS }}>
                    {job.error}
                  </div>
                )}
                {job.result && job.status === "completed" && (
                  <div style={{ fontSize: "10px", color: "#22c55e", marginTop: "4px", fontFamily: SANS }}>
                    {JSON.stringify(job.result).slice(0, 80)}
                  </div>
                )}
              </div>

              {/* Right: job id (truncated) */}
              <div style={{ fontSize: "9px", color: "#1e293b", textAlign: "right", paddingTop: "2px" }}>
                {job.job_id.slice(-8)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Trigger modal */}
      {modal && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(5,8,16,0.88)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 200,
          padding: "24px",
        }}>
          <div style={{
            background: "#090e1a",
            border: `1px solid ${TYPE_COLOR[modal.type]}`,
            padding: "24px",
            width: "100%",
            maxWidth: "380px",
          }}>
            <div style={{ fontSize: "10px", color: TYPE_COLOR[modal.type], letterSpacing: "0.18em", marginBottom: "16px" }}>
              TRIGGER {TYPE_LABEL[modal.type]}
            </div>

            {modal.type === "research" && (
              <input
                autoFocus
                value={triggerInput}
                onChange={(e) => setTriggerInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleTrigger()}
                placeholder="Search query..."
                style={{
                  width: "100%",
                  background: "#0a0f1a",
                  border: "1px solid #1e293b",
                  color: "#e2e8f0",
                  padding: "10px 12px",
                  fontFamily: MONO,
                  fontSize: "12px",
                  marginBottom: "16px",
                  boxSizing: "border-box",
                }}
              />
            )}

            {modal.type === "summary" && (
              <div style={{ fontSize: "12px", color: "#94a3b8", fontFamily: SANS, marginBottom: "16px", lineHeight: 1.5 }}>
                Summarize the last 20 agent runs for session: <strong>{sessionId ?? "anon"}</strong>
              </div>
            )}

            {modal.type === "deadline_sweep" && (
              <div style={{ fontSize: "12px", color: "#94a3b8", fontFamily: SANS, marginBottom: "16px", lineHeight: 1.5 }}>
                Manually trigger the 6h deadline sweep. Scans all open/in_progress tasks stale for 48h+.
              </div>
            )}

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={handleTrigger}
                disabled={triggering}
                style={{
                  flex: 1,
                  background: TYPE_COLOR[modal.type],
                  border: "none",
                  color: "#fff",
                  padding: "12px",
                  cursor: triggering ? "not-allowed" : "pointer",
                  fontFamily: MONO,
                  fontSize: "10px",
                  letterSpacing: "0.12em",
                  opacity: triggering ? 0.6 : 1,
                }}
              >
                {triggering ? "DISPATCHING..." : "DISPATCH"}
              </button>
              <button
                onClick={() => { setModal(null); setTriggerInput(""); }}
                style={{
                  flex: 1,
                  background: "none",
                  border: "1px solid #1e293b",
                  color: "#4a5568",
                  padding: "12px",
                  cursor: "pointer",
                  fontFamily: MONO,
                  fontSize: "10px",
                  letterSpacing: "0.12em",
                }}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
