// useSessions.ts — Turn 10: polls GET /api/v1/sessions every 5s
// Returns: { sessions, loading, error }
// Cleans up interval and aborts in-flight fetch on unmount.
// Session type mirrors backend SessionRow shape.

import { useState, useEffect, useCallback, useRef } from "react";

export interface Session {
  session_id:     string;
  last_agent:     string;
  total_cost_usd: number;
  run_count:      number;
  last_activity:  string;
  domain:         "legal" | "research" | "finance" | "engineering" | "general";
}

interface UseSessionsResult {
  sessions: Session[];
  loading:  boolean;
  error:    string | null;
  refresh:  () => void;
}

const POLL_MS = 5_000;

export function useSessions(): UseSessionsResult {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const abortRef                = useRef<AbortController | null>(null);

  const fetchSessions = useCallback(async () => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/v1/sessions", {
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`Sessions API ${res.status}`);

      const data: { sessions: Session[] } = await res.json();
      setSessions(data.sessions ?? []);
      setError(null);
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // unmount cleanup — not an error
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, POLL_MS);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [fetchSessions]);

  return { sessions, loading, error, refresh: fetchSessions };
}
