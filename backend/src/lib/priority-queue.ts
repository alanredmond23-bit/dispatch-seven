// lib/priority-queue.ts — min-heap priority queue for D7 agent tasks
// Priority levels: CRITICAL=0, HIGH=1, NORMAL=2, LOW=3
//
// Designed for the D7 agent execution layer:
//   - Legal deadline tasks → CRITICAL
//   - User-interactive WS tasks → HIGH
//   - Background research/summarization → NORMAL
//   - Scheduled sweeps, backfill jobs → LOW
//
// Usage:
//   const q = new PriorityQueue<AgentTask>();
//   q.enqueue(task, Priority.HIGH);
//   const next = q.dequeue();       // returns highest-priority item
//   const stats = q.stats();        // { depth, byPriority }

export enum Priority {
  CRITICAL = 0,
  HIGH     = 1,
  NORMAL   = 2,
  LOW      = 3,
}

export interface PriorityLabel {
  priority: Priority;
  label: "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
}

export const PRIORITY_LABELS: Record<Priority, PriorityLabel["label"]> = {
  [Priority.CRITICAL]: "CRITICAL",
  [Priority.HIGH]:     "HIGH",
  [Priority.NORMAL]:   "NORMAL",
  [Priority.LOW]:      "LOW",
};

/** Parse a string priority label to enum value. Defaults to NORMAL. */
export function parsePriority(raw: string | undefined): Priority {
  switch ((raw ?? "").toUpperCase()) {
    case "CRITICAL": return Priority.CRITICAL;
    case "HIGH":     return Priority.HIGH;
    case "LOW":      return Priority.LOW;
    default:         return Priority.NORMAL;
  }
}

interface HeapNode<T> {
  item:       T;
  priority:   Priority;
  enqueuedAt: number; // epoch ms — used as tiebreaker (FIFO within same priority)
  id:         string; // caller-supplied stable id for dequeue-by-id
}

/** Min-heap: lower priority number = higher urgency = dequeued first. */
export class PriorityQueue<T> {
  private heap: HeapNode<T>[] = [];

  get size(): number {
    return this.heap.length;
  }

  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /** Add an item to the queue. O(log n). */
  enqueue(item: T, priority: Priority, id = crypto.randomUUID()): string {
    const node: HeapNode<T> = { item, priority, enqueuedAt: Date.now(), id };
    this.heap.push(node);
    this._bubbleUp(this.heap.length - 1);
    return id;
  }

  /** Remove and return the highest-priority item. O(log n). Returns null if empty. */
  dequeue(): T | null {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return top.item;
  }

  /** Peek without removing. O(1). */
  peek(): T | null {
    return this.heap[0]?.item ?? null;
  }

  /** Remove a specific item by id. O(n). Returns true if found and removed. */
  remove(id: string): boolean {
    const idx = this.heap.findIndex((n) => n.id === id);
    if (idx === -1) return false;
    const last = this.heap.pop()!;
    if (idx < this.heap.length) {
      this.heap[idx] = last;
      this._bubbleUp(idx);
      this._sinkDown(idx);
    }
    return true;
  }

  /** Stats for observability / health endpoint. */
  stats(): { depth: number; byPriority: Record<string, number> } {
    const byPriority: Record<string, number> = {
      CRITICAL: 0, HIGH: 0, NORMAL: 0, LOW: 0,
    };
    for (const node of this.heap) {
      byPriority[PRIORITY_LABELS[node.priority]]++;
    }
    return { depth: this.heap.length, byPriority };
  }

  // ── Heap internals ─────────────────────────────────────────────────────

  private _compare(a: HeapNode<T>, b: HeapNode<T>): boolean {
    // Lower priority number wins; break ties by enqueuedAt (FIFO)
    if (a.priority !== b.priority) return a.priority < b.priority;
    return a.enqueuedAt < b.enqueuedAt;
  }

  private _bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this._compare(this.heap[idx], this.heap[parent])) {
        [this.heap[idx], this.heap[parent]] = [this.heap[parent], this.heap[idx]];
        idx = parent;
      } else {
        break;
      }
    }
  }

  private _sinkDown(idx: number): void {
    const n = this.heap.length;
    while (true) {
      const left  = 2 * idx + 1;
      const right = 2 * idx + 2;
      let smallest = idx;

      if (left < n  && this._compare(this.heap[left],  this.heap[smallest])) smallest = left;
      if (right < n && this._compare(this.heap[right], this.heap[smallest])) smallest = right;

      if (smallest !== idx) {
        [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
        idx = smallest;
      } else {
        break;
      }
    }
  }
}
