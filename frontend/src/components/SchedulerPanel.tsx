// SchedulerPanel.tsx — upcoming deadline timeline for D7
// Polls GET /api/v1/schedule every 30s (deadlines don't change per-second).
// Color-coded by domain. Mobile-friendly card stack. Zero dependencies beyond React.
//
// Domain colors:
//   LEGAL    = #DC2626  (red    — court deadlines are life-or-death)
//   CODE     = #5B6EF5  (indigo — sprint/deploy milestones)
//   RESEARCH = #22C55E  (green  — reports, interviews)
//   FINANCE  = #A855F7  (purple — invoices, payments)
//   PERSONAL = #F59E0B  (amber  — personal reminders)
//   SCHEDULER= #64748B  (slate  — meta tasks)

import { useEffect, useState, useCallback } from "react";

// ── TYPES ─────────────────────────────────────────────────────────────────────
type Domain = "LEGAL" | "CODE" | "RESEARCH" | "FINANCE" | "PERSONAL" | "SCHEDULER";
type Priority = "p0" | "p1" | "p2" | "p3";

interface UpcomingTask {
  id:         string;
  title:      string;
  due_date:   string | null;
  priority:   Priority;
  domain:     Domain;
  notes:      string | null;
  days_until: number | null;
  overdue:    boolean;
}

interface SchedulerPanelProps {
  /** Filter to single domain — omit for all */
  domain?: Domain;
  /** Max tasks to show (default 20) */
  limit?: number;
  /** Backend base URL (default: relative /api/v1/schedule) */
  apiBase?: string;
  /** Hide if no tasks (default: false — show empty state) */
  hideWhenEmpty?: boolean;
}

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 30_000;

const DOMAIN_COLORS: Record<Domain, { bg: string; text: string; border: string; dot: string }> = {
  LEGAL:     { bg: "#FEF2F2", text: "#991B1B", border: "#FCA5A5", dot: "#DC2626" },
  CODE:      { bg: "#EEF2FF", text: "#3730A3", border: "#A5B4FC", dot: "#5B6EF5" },
  RESEARCH:  { bg: "#F0FDF4", text: "#166534", border: "#86EFAC", dot: "#22C55E" },
  FINANCE:   { bg: "#FAF5FF", text: "#6B21A8", border: "#D8B4FE", dot: "#A855F7" },
  PERSONAL:  { bg: "#FFFBEB", text: "#92400E", border: "#FCD34D", dot: "#F59E0B" },
  SCHEDULER: { bg: "#F8FAFC", text: "#334155", border: "#CBD5E1", dot: "#64748B" },
};

const PRIORITY_LABELS: Record<Priority, string> = {
  p0: "P0 — Critical",
  p1: "P1 — High",
  p2: "P2 — Medium",
  p3: "P3 — Low",
};

const PRIORITY_BADGE: Record<Priority, string> = {
  p0: "background:#DC2626;color:#fff",
  p1: "background:#D97706;color:#fff",
  p2: "background:#3B82F6;color:#fff",
  p3: "background:#6B7280;color:#fff",
};

// ── HELPERS ───────────────────────────────────────────────────────────────────
function formatDueDate(iso: string | null): string {
  if (!iso) return "No date";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function daysLabel(days: number | null, overdue: boolean): { text: string; color: string } {
  if (days === null) return { text: "No date", color: "#9CA3AF" };
  if (overdue)       return { text: `${Math.abs(days)}d overdue`, color: "#DC2626" };
  if (days === 0)    return { text: "Today",   color: "#D97706" };
  if (days === 1)    return { text: "Tomorrow", color: "#D97706" };
  if (days <= 7)     return { text: `${days}d away`, color: "#5B6EF5" };
  if (days <= 30)    return { text: `${days}d away`, color: "#22C55E" };
  return { text: `${days}d away`, color: "#9CA3AF" };
}

// ── DEADLINE CARD ─────────────────────────────────────────────────────────────
function DeadlineCard({ task }: { task: UpcomingTask }) {
  const colors  = DOMAIN_COLORS[task.domain] ?? DOMAIN_COLORS.SCHEDULER;
  const { text: daysText, color: daysColor } = daysLabel(task.days_until, task.overdue);
  const priority = (task.priority ?? "p2") as Priority;

  return (
    <div
      style={{
        background:   colors.bg,
        borderLeft:   `4px solid ${colors.dot}`,
        border:       `1px solid ${colors.border}`,
        borderRadius: "8px",
        padding:      "12px 14px",
        display:      "flex",
        flexDirection: "column",
        gap:          "6px",
        boxShadow:    task.overdue ? "0 0 0 2px #FCA5A5" : "none",
      }}
    >
      {/* Top row: title + priority badge */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
        <span
          style={{
            fontWeight: 600,
            fontSize:   "0.85rem",
            color:      colors.text,
            lineHeight: "1.3",
            flex:       1,
          }}
        >
          {task.overdue && <span style={{ color: "#DC2626" }}>⚠ </span>}
          {task.title}
        </span>
        <span
          style={{
            ...Object.fromEntries(
              PRIORITY_BADGE[priority].split(";").map((s) => {
                const [k, v] = s.split(":");
                return [k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v];
              })
            ),
            fontSize:     "0.65rem",
            fontWeight:   700,
            padding:      "2px 6px",
            borderRadius: "4px",
            whiteSpace:   "nowrap",
            flexShrink:   0,
          }}
        >
          {priority.toUpperCase()}
        </span>
      </div>

      {/* Middle row: date + countdown */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.75rem" }}>
        <span style={{ color: "#6B7280" }}>{formatDueDate(task.due_date)}</span>
        <span style={{ color: daysColor, fontWeight: 600 }}>{daysText}</span>
      </div>

      {/* Domain chip */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <span
          style={{
            background:   colors.dot,
            color:        "#fff",
            fontSize:     "0.6rem",
            fontWeight:   700,
            padding:      "1px 6px",
            borderRadius: "100px",
            letterSpacing: "0.05em",
          }}
        >
          {task.domain}
        </span>
        {task.notes && (
          <span style={{ fontSize: "0.7rem", color: "#9CA3AF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {task.notes}
          </span>
        )}
      </div>
    </div>
  );
}

// ── TIMELINE DIVIDERS ─────────────────────────────────────────────────────────
// Group tasks into: Overdue / This Week / This Month / Later
type Bucket = "OVERDUE" | "THIS_WEEK" | "THIS_MONTH" | "LATER" | "NO_DATE";

function getBucket(task: UpcomingTask): Bucket {
  if (task.days_until === null) return "NO_DATE";
  if (task.overdue)              return "OVERDUE";
  if (task.days_until <= 7)      return "THIS_WEEK";
  if (task.days_until <= 30)     return "THIS_MONTH";
  return "LATER";
}

const BUCKET_LABELS: Record<Bucket, string> = {
  OVERDUE:    "⚠ Overdue",
  THIS_WEEK:  "This Week",
  THIS_MONTH: "This Month",
  LATER:      "Later",
  NO_DATE:    "No Date Set",
};

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────────
export default function SchedulerPanel({
  domain,
  limit = 20,
  apiBase = "",
  hideWhenEmpty = false,
}: SchedulerPanelProps) {
  const [tasks,   setTasks]   = useState<UpcomingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(limit), includeOverdue: "true" });
      if (domain) params.set("domain", domain);
      const res  = await fetch(`${apiBase}/api/v1/schedule?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setTasks(json.tasks ?? []);
      setError(null);
      setLastFetch(new Date());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [domain, limit, apiBase]);

  // Initial load + polling
  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  // Hide when empty if requested
  if (!loading && tasks.length === 0 && hideWhenEmpty) return null;

  // Group tasks by bucket
  const buckets: Partial<Record<Bucket, UpcomingTask[]>> = {};
  for (const task of tasks) {
    const b = getBucket(task);
    if (!buckets[b]) buckets[b] = [];
    buckets[b]!.push(task);
  }
  const bucketOrder: Bucket[] = ["OVERDUE", "THIS_WEEK", "THIS_MONTH", "LATER", "NO_DATE"];

  // Count overdue for header badge
  const overdueCount = buckets["OVERDUE"]?.length ?? 0;

  return (
    <div
      style={{
        background:   "#FFFFFF",
        border:       "1px solid #E5E7EB",
        borderRadius: "10px",
        overflow:     "hidden",
        fontFamily:   "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Panel Header */}
      <div
        style={{
          padding:        "12px 16px",
          borderBottom:   "1px solid #E5E7EB",
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          background:     "#F9FAFB",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "1rem" }}>📅</span>
          <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#111827" }}>
            {domain ? `${domain} Deadlines` : "Upcoming Deadlines"}
          </span>
          {overdueCount > 0 && (
            <span
              style={{
                background:   "#DC2626",
                color:        "#fff",
                fontSize:     "0.65rem",
                fontWeight:   700,
                padding:      "1px 7px",
                borderRadius: "100px",
              }}
            >
              {overdueCount} overdue
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {lastFetch && (
            <span style={{ fontSize: "0.65rem", color: "#9CA3AF" }}>
              {lastFetch.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={fetchTasks}
            title="Refresh"
            style={{
              background:   "none",
              border:       "none",
              cursor:       "pointer",
              color:        "#9CA3AF",
              fontSize:     "0.75rem",
              padding:      "2px 4px",
            }}
          >
            ↺
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "12px", maxHeight: "500px", overflowY: "auto" }}>

        {/* Loading state */}
        {loading && (
          <div style={{ textAlign: "center", padding: "24px", color: "#9CA3AF", fontSize: "0.8rem" }}>
            Loading deadlines…
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div
            style={{
              background: "#FEF2F2",
              border:     "1px solid #FCA5A5",
              borderRadius: "6px",
              padding:    "10px 12px",
              fontSize:   "0.75rem",
              color:      "#991B1B",
            }}
          >
            Failed to load deadlines: {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && tasks.length === 0 && (
          <div style={{ textAlign: "center", padding: "24px", color: "#9CA3AF", fontSize: "0.8rem" }}>
            No upcoming deadlines.
            <br />
            <span style={{ fontSize: "0.7rem" }}>
              Tell SCHEDULER about a deadline to add it here.
            </span>
          </div>
        )}

        {/* Bucketed timeline */}
        {!loading && !error && tasks.length > 0 &&
          bucketOrder.map((bucket) => {
            const group = buckets[bucket];
            if (!group || group.length === 0) return null;
            return (
              <div key={bucket} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {/* Divider */}
                <div
                  style={{
                    display:    "flex",
                    alignItems: "center",
                    gap:        "8px",
                    fontSize:   "0.7rem",
                    fontWeight: 600,
                    color:      bucket === "OVERDUE" ? "#DC2626" : "#6B7280",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  <div style={{ flex: 1, height: "1px", background: "#E5E7EB" }} />
                  {BUCKET_LABELS[bucket]}
                  <div style={{ flex: 1, height: "1px", background: "#E5E7EB" }} />
                </div>
                {/* Cards */}
                {group.map((task) => (
                  <DeadlineCard key={task.id} task={task} />
                ))}
              </div>
            );
          })
        }
      </div>
    </div>
  );
}
