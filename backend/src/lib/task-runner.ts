// lib/task-runner.ts — concurrent agent task runner backed by PriorityQueue
//
// Wraps PriorityQueue with:
//   - Configurable concurrency limit (default: 5 simultaneous agents)
//   - Per-priority concurrency reservation:
//       CRITICAL: always runs immediately (bypasses slot limit when critical queue non-empty)
//       HIGH:     max 3 concurrent slots
//       NORMAL:   max 2 concurrent slots
//       LOW:      max 1 concurrent slot (background only)
//   - enqueue() returns a Promise<T> that resolves when the task completes
//   - stats() for /health endpoint
//
// Integration: wire into dag-executor, Inngest job dispatch, and /api/v1/jobs/enqueue

import { PriorityQueue, Priority, parsePriority } from "./priority-queue.js";
export { Priority, parsePriority };

export type TaskFn<T> = () => Promise<T>;

interface PendingTask<T> {
  fn:      TaskFn<T>;
  priority: Priority;
  resolve: (value: T) => void;
  reject:  (reason: unknown) => void;
  id:      string;
  queuedAt: number;
}

// Per-priority concurrency caps
const PRIORITY_SLOTS: Record<Priority, number> = {
  [Priority.CRITICAL]: Infinity, // never blocked
  [Priority.HIGH]:     3,
  [Priority.NORMAL]:   2,
  [Priority.LOW]:      1,
};

export class TaskRunner<T = unknown> {
  private queue = new PriorityQueue<PendingTask<T>>();
  private active = new Map<string, { priority: Priority; startedAt: number }>();
  private maxConcurrency: number;

  constructor(maxConcurrency = 5) {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Enqueue a task. Returns a Promise that resolves/rejects when the task runs.
   * @param fn       — async function to execute
   * @param priority — Priority enum value (default: NORMAL)
   */
  enqueue(fn: TaskFn<T>, priority: Priority = Priority.NORMAL): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();
      const task: PendingTask<T> = { fn, priority, resolve, reject, id, queuedAt: Date.now() };
      this.queue.enqueue(task, priority, id);
      this._drain();
    });
  }

  /** Cancel a queued task by id. Returns false if already running or not found. */
  cancel(id: string): boolean {
    return this.queue.remove(id);
  }

  /** Current runner stats — exposed via /health and /api/v1/jobs/queue-stats */
  stats() {
    const queueStats = this.queue.stats();
    const activeByPriority: Record<string, number> = { CRITICAL: 0, HIGH: 0, NORMAL: 0, LOW: 0 };
    const priorityLabels = ["CRITICAL", "HIGH", "NORMAL", "LOW"] as const;
    for (const { priority } of this.active.values()) {
      activeByPriority[priorityLabels[priority]]++;
    }
    return {
      queued:    queueStats,
      active:    { total: this.active.size, byPriority: activeByPriority },
      capacity:  this.maxConcurrency,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _drain(): void {
    while (!this.queue.isEmpty) {
      if (this.active.size >= this.maxConcurrency) break;

      const next = this.queue.peek()!;

      // Per-priority slot check
      const priorityActive = [...this.active.values()].filter(
        (a) => a.priority === next.priority
      ).length;
      if (priorityActive >= PRIORITY_SLOTS[next.priority]) break;

      // Dequeue and run
      const task = this.queue.dequeue()!;
      this._run(task);
    }
  }

  private async _run(task: PendingTask<T>): Promise<void> {
    this.active.set(task.id, { priority: task.priority, startedAt: Date.now() });
    try {
      const result = await task.fn();
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    } finally {
      this.active.delete(task.id);
      this._drain(); // pick up next queued task
    }
  }
}

// ── Singleton global runner ────────────────────────────────────────────────
// Exported for use in dag-executor and Inngest jobs.
// MAX_AGENT_CONCURRENCY env var lets ops tune without redeploy.

const MAX_CONCURRENCY = parseInt(process.env.MAX_AGENT_CONCURRENCY ?? "5", 10);
export const globalTaskRunner = new TaskRunner(MAX_CONCURRENCY);
