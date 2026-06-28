// useDecompose.ts — auto-detects multi-step messages and triggers /api/v1/decompose.
// Multi-step signal: message > 200 chars AND contains "and|then|also|after|first|next|then".
// Ponytail: no debounce lib, plain regex, plain fetch.

import { useState, useCallback } from "react";
import type { GraphTask } from "../components/TaskGraph";

const MULTI_STEP_RE = /\b(and|then|also|after|first|next|before|finally|additionally)\b/i;

function isMultiStep(content: string): boolean {
  return content.length > 200 && MULTI_STEP_RE.test(content);
}

export interface UseDecomposeReturn {
  /** Call before sending to WS — returns tasks if multi-step, null otherwise */
  maybeDecompose: (content: string) => Promise<GraphTask[] | null>;
  tasks:          GraphTask[] | null;
  decomposing:    boolean;
  dismiss:        () => void;
}

export function useDecompose(sessionId: string): UseDecomposeReturn {
  const [tasks,       setTasks]       = useState<GraphTask[] | null>(null);
  const [decomposing, setDecomposing] = useState(false);

  const maybeDecompose = useCallback(
    async (content: string): Promise<GraphTask[] | null> => {
      if (!isMultiStep(content)) return null;

      setDecomposing(true);
      try {
        const res = await fetch("/api/v1/decompose", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ session_id: sessionId, goal: content }),
        });

        if (!res.ok) return null;

        const data: { tasks: GraphTask[] } = await res.json();
        const t = data.tasks ?? null;
        setTasks(t);
        return t;
      } catch {
        return null;
      } finally {
        setDecomposing(false);
      }
    },
    [sessionId]
  );

  const dismiss = useCallback(() => setTasks(null), []);

  return { maybeDecompose, tasks, decomposing, dismiss };
}
