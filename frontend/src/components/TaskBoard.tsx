// TaskBoard — real-time task progress board for D7 agent orchestration.
//
// P0: Closes the "tasks run blind" gap vs Anthropic Cowork.
// Polls /api/v1/tasks?session_id=X&active=true every 2s.
// Shows: agent name, status badge, elapsed time, cost, progress bar.
//
// P1 upgrade path: swap setInterval poll → supabase.channel() realtime subscription.
// Ponytail: poll first, realtime second. Ship what works now.

import { useEffect, useRef, useState } from "react";

// ── TYPES ─────────────────────────────────────────────────────────────────────
export type TaskStatus = "queued" | "running" | "done" | "failed";

export interface TaskRecord {
  id:           string;
  title:        string;
  status:       TaskStatus;
  progress_pct: number;    // 0–100
  agent_name:   string;    // e.g. 'LEGAL' | 'RESEARCH' | 'BUILD'
  cost_usd:     number;
  started_at:   string | null;    // ISO
  completed_at: string | null;    // ISO
  error?:       string;
}

interface TaskBoardProps {
  sessionId: string;
  /** Collapse board when no active tasks (default: true) */
  collapseWhenIdle?: boolean;
}

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 2_000;
const TASKS_ENDPOINT   = (sid: string) =>
  `/api/v1/tasks?session_id=${encodeURIComponent(sid)}&active=true`;

// ── STATUS METADATA ───────────────────────────────────────────────────────────
const STATUS_META: Record<TaskStatus, { label: string; color: string; dot: string }> = {
  queued:  { label: "Queued",  color: "bg-yellow-100 text-yellow-800", dot: "bg-yellow-400" },
  running: { label: "Running", color: "bg-blue-100 text-blue-800",     dot: "bg-blue-500 animate-pulse" },
  done:    { label: "Done",    color: "bg-green-100 text-green-800",   dot: "bg-green-500" },
  failed:  { label: "Failed",  color: "bg-red-100 text-red-800",       dot: "bg-red-500" },
};

// ── HELPERS ───────────────────────────────────────────────────────────────────
function elapsedLabel(started_at: string | null, completed_at: string | null): string {
  if (!started_at) return "";
  const end = completed_at ? new Date(completed_at).getTime() : Date.now();
  const ms  = end - new Date(started_at).getTime();
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function costLabel(cost_usd: number): string {
  if (cost_usd === 0) return "";
  if (cost_usd < 0.001) return `<$0.001`;
  return `$${cost_usd.toFixed(3)}`;
}

// ── TASK CARD ─────────────────────────────────────────────────────────────────
function TaskCard({ task, now }: { task: TaskRecord; now: number }) {
  const meta     = STATUS_META[task.status];
  const elapsed  = elapsedLabel(task.started_at, task.completed_at);
  const cost     = costLabel(task.cost_usd);
  const progress = Math.min(100, Math.max(0, task.progress_pct));

  // Recompute live elapsed for running tasks
  const liveElapsed = task.status === "running" && task.started_at
    ? elapsedLabel(task.started_at, new Date(now).toISOString())
    : elapsed;

  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg border border-gray-200 bg-white shadow-sm text-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Status dot */}
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
          {/* Agent badge */}
          <span className="font-mono text-xs font-semibold text-gray-500 flex-shrink-0">
            {task.agent_name}
          </span>
          {/* Task title */}
          <span className="truncate text-gray-800 font-medium">{task.title}</span>
        </div>
        {/* Right side: status pill + cost + elapsed */}
        <div className="flex items-center gap-2 flex-shrink-0 text-xs">
          {cost && (
            <span className="text-gray-400 font-mono">{cost}</span>
          )}
          {liveElapsed && (
            <span className="text-gray-400">{liveElapsed}</span>
          )}
          <span className={`px-2 py-0.5 rounded-full font-medium ${meta.color}`}>
            {meta.label}
          </span>
        </div>
      </div>

      {/* Progress bar — shown for queued/running */}
      {(task.status === "queued" || task.status === "running") && (
        <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden mt-1">
          <div
            className="h-full bg-blue-500 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Error detail */}
      {task.status === "failed" && task.error && (
        <p className="text-xs text-red-600 mt-1 font-mono truncate">{task.error}</p>
      )}
    </div>
  );
}

// ── TASK BOARD ────────────────────────────────────────────────────────────────
export function TaskBoard({ sessionId, collapseWhenIdle = true }: TaskBoardProps) {
  const [tasks,     setTasks]     = useState<TaskRecord[]>([]);
  const [lastPoll,  setLastPoll]  = useState<Date | null>(null);
  const [pollError, setPollError] = useState(false);
  const [now,       setNow]       = useState(Date.now());
  const timerRef                  = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef                  = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch tasks from backend
  const fetchTasks = async () => {
    try {
      const res = await fetch(TASKS_ENDPOINT(sessionId));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TaskRecord[] = await res.json();
      setTasks(data);
      setLastPoll(new Date());
      setPollError(false);
    } catch {
      setPollError(true);
    }
  };

  // Poll every 2s
  useEffect(() => {
    fetchTasks(); // immediate first fetch
    timerRef.current = setInterval(fetchTasks, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Live clock for elapsed time on running tasks
  useEffect(() => {
    clockRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (clockRef.current) clearInterval(clockRef.current);
    };
  }, []);

  const activeTasks    = tasks.filter((t) => t.status === "queued" || t.status === "running");
  const recentTasks    = tasks.filter((t) => t.status === "done" || t.status === "failed");
  const hasAnything    = tasks.length > 0;
  const totalCost      = tasks.reduce((sum, t) => sum + t.cost_usd, 0);
  const runningCount   = activeTasks.length;

  // Collapse board when idle and no tasks
  if (collapseWhenIdle && !hasAnything) return null;

  return (
    <div className="w-full rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
      {/* Board header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700">Agent Tasks</span>
          {runningCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              {runningCount} running
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          {totalCost > 0 && (
            <span className="font-mono">{costLabel(totalCost)} total</span>
          )}
          {pollError && (
            <span className="text-red-400">⚠ poll error</span>
          )}
          {lastPoll && !pollError && (
            <span>updated {Math.round((Date.now() - lastPoll.getTime()) / 1000)}s ago</span>
          )}
        </div>
      </div>

      {/* Task list */}
      <div className="flex flex-col gap-2 p-3">
        {/* Active tasks first */}
        {activeTasks.map((t) => (
          <TaskCard key={t.id} task={t} now={now} />
        ))}

        {/* Recent completed/failed */}
        {recentTasks.length > 0 && (
          <>
            {activeTasks.length > 0 && (
              <div className="border-t border-gray-200 my-1" />
            )}
            {recentTasks.map((t) => (
              <TaskCard key={t.id} task={t} now={now} />
            ))}
          </>
        )}

        {/* Empty state */}
        {!hasAnything && (
          <p className="text-xs text-gray-400 text-center py-4">
            No recent tasks. Submit a prompt to get started.
          </p>
        )}
      </div>
    </div>
  );
}

export default TaskBoard;
