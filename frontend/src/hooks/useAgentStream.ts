// useAgentStream.ts — thin hook wrapping wsSchedule; exposes isTyping for UI
// Ponytail: no state machine, just isTyping bool + results
import { useState, useCallback } from "react";
import { generateScheduleViaWs } from "../lib/wsSchedule";

interface UseAgentStreamResult {
  isTyping: boolean;
  run: (prompt: string, sessionId?: string) => Promise<string | null>;
}

export function useAgentStream(): UseAgentStreamResult {
  const [isTyping, setIsTyping] = useState(false);

  const run = useCallback(async (prompt: string, sessionId?: string): Promise<string | null> => {
    setIsTyping(true);
    try {
      const result = await generateScheduleViaWs(prompt, sessionId);
      return result;
    } catch (err) {
      console.error("[useAgentStream]", err);
      return null;
    } finally {
      setIsTyping(false);
    }
  }, []);

  return { isTyping, run };
// useAgentStream — wraps useWebSocket with smooth token buffering + typing indicator.
// Uses rAF (16ms) to batch token appends and avoid layout thrash.
// Message status: 'streaming' | 'complete' | 'error'
//
// Turn 2 additions:
//  - reconnectAttempts + wsStatus exposed for ConnectionBadge
//  - Supabase polling fallback: if WS is silent for >5s while isTyping=true,
//    polls GET /api/v1/runs?session_id=X and surfaces a completed run the WS missed.
//    Fixes the Cowork SendUserMessage silent-drop bug.
// P0 ADDITION: Supabase polling fallback
//   If WS is silent for >WS_SILENCE_THRESHOLD_MS, we fall back to polling
//   /api/v1/runs?session_id=X every POLL_INTERVAL_MS to recover any dropped messages.
//   Deduplication by run_id prevents double-render when WS reconnects.
//
// Ponytail: rAF buffer + poll fallback. Upgrade to realtime subscription in P1.

// Ponytail: basic WS + rAF buffer. Add readDataStreamResponse when SSE transport is wired.
import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "./useWebSocket";
export type MessageStatus = "idle" | "streaming" | "complete" | "error";
export interface AgentMessage {
  id:      string;
  content: string;
  status:  MessageStatus;
  run_id?: string; // set from Supabase recovery for dedup
}

export interface RouteInfo {
  agent: string;
  model: string;
}

export interface UseAgentStreamReturn {
  send:              (content: string) => void;
  messages:          AgentMessage[];
  isTyping:          boolean;
  wsStatus:          "connecting" | "open" | "closed" | "error";
  reconnectAttempts: number;
  clearMessages:     () => void;
  send:          (content: string) => void;
  messages:      AgentMessage[];
  isTyping:      boolean;
  wsStatus:      "connecting" | "open" | "closed" | "error";
  clearMessages: () => void;
  /** Active route: which agent + model is handling current stream */
  routeInfo:   RouteInfo | null;
  isPolling:     boolean; // true when operating on poll fallback
}

// ── P0 POLLING CONSTANTS ──────────────────────────────────────────────────────
const WS_SILENCE_THRESHOLD_MS = 3_000; // WS must be silent this long before poll activates
const POLL_INTERVAL_MS        = 2_000; // how often to query /api/v1/runs in fallback mode

  const [messages,  setMessages]  = useState<AgentMessage[]>([]);
  const [isTyping,  setIsTyping]  = useState(false);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
// Backend route that proxies dispatch7.agent_runs for the frontend
const RUNS_ENDPOINT = (sid: string) =>
  `/api/v1/runs?session_id=${encodeURIComponent(sid)}&status=streaming&limit=1`;

// ── SUPABASE RUN ROW (partial) ────────────────────────────────────────────────
interface RunRow {
  id:         string;
  chunk_text: string | null;
  status:     "streaming" | "complete" | "error";
  agent_name: string;
}

const API_BASE     = (import.meta as { env: Record<string, string> }).env?.VITE_API_URL ?? "";
const SILENCE_MS   = 5_000;   // poll fallback fires after 5s silence while isTyping

export function useAgentStream(sessionId: string): UseAgentStreamReturn {
  const [reconnecting, setReconnecting] = useState(false);

  const handleReconnecting = useCallback(() => setReconnecting(true), []);

  const { send: wsSend, messages: rawMessages, status: wsStatus, reconnectAttempts } =
    useWebSocket(sessionId, handleReconnecting);

  const [messages,   setMessages]  = useState<AgentMessage[]>([]);
  const [isTyping,   setIsTyping]  = useState(false);
  const [isPolling,  setIsPolling] = useState(false);

  // Token buffer for rAF batching — avoids one setState per token
  const tokenBufRef  = useRef<string>("");
  const rafRef       = useRef<number | null>(null);
  const activeIdRef  = useRef<string | null>(null);

  // Polling fallback: tracks last WS message timestamp; fires if >SILENCE_MS while isTyping
  const lastMsgRef     = useRef<number>(Date.now());
  const pollTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const polledRunRef   = useRef<string | null>(null);  // last run id surfaced by polling
  const isTypingRef    = useRef(false);
  isTypingRef.current  = isTyping;

  // P0: track last WS activity timestamp and seen run_ids to prevent dedup
  const lastWsActivityRef = useRef<number>(Date.now());
  const seenRunIdsRef     = useRef<Set<string>>(new Set());
  const pollTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  // ── FLUSH BUFFERED TOKENS ─────────────────────────────────────────────────
  const [messages,  setMessages]  = useState<AgentMessage[]>([]);
  const [isTyping,  setIsTyping]  = useState(false);
  const tokenBufRef    = useRef<string>("");
  const rafRef         = useRef<number | null>(null);
  const activeIdRef    = useRef<string | null>(null);
  // Flush buffered tokens into the active message via a single setState
  const flushTokens = useCallback(() => {
    rafRef.current = null;
    const chunk = tokenBufRef.current;
    if (!chunk || !activeIdRef.current) return;
    tokenBufRef.current = "";
    setMessages((prev) =>
      prev.map((m) =>
        m.id === activeIdRef.current
          ? { ...m, content: m.content + chunk }
          : m
      )
    );
  }, []);

  // Polling fallback effect — runs independently of WS message processing
  useEffect(() => {
    pollTimerRef.current = setInterval(async () => {
      if (!isTypingRef.current) return;
      if (Date.now() - lastMsgRef.current < SILENCE_MS) return;

      // WS is silent while we're expecting a response — check runs table
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/runs?session_id=${encodeURIComponent(sessionId)}`
        );
        if (!res.ok) return;
        const { runs } = await res.json() as { runs: Array<{ id: string; status: string; finished_at?: string }> };
        const completed = runs.find(
          (r) => r.status === "done" && r.id !== polledRunRef.current
        );
        if (!completed) return;

        // WS dropped the completion — surface a synthetic done event
        polledRunRef.current = completed.id;
        console.warn("[useAgentStream] polling fallback: WS silent, surfacing completed run", completed.id);

        // Flush any buffered tokens then mark complete
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
          flushTokens();
        }
        if (activeIdRef.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === activeIdRef.current
                ? { ...m, content: m.content || "(response delivered via fallback)", status: "complete" }
                : m
            )
          );
        }
        activeIdRef.current = null;
        setIsTyping(false);
      } catch {
        // polling error — silent, WS will recover on reconnect
      }
    }, SILENCE_MS);

    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); };
  }, [sessionId, flushTokens]);

  // Process raw WS messages
  useEffect(() => {
    for (const raw of rawMessages) {
      if (raw.type === "route" && raw.agent) {
        setRouteInfo({ agent: raw.agent, model: raw.model ?? "" });
      } else if (raw.type === "token" && raw.content !== undefined) {
      lastMsgRef.current = Date.now();  // reset silence timer on any WS message
  // ── PROCESS WS MESSAGES ───────────────────────────────────────────────────
  // Process raw WS messages as they arrive
      // Record WS activity so polling knows WS is alive
      lastWsActivityRef.current = Date.now();

      if (raw.type === "token" && raw.content !== undefined) {
        if (!activeIdRef.current) {
          const newId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          activeIdRef.current = newId;
          setIsTyping(true);
          setReconnecting(false);
          setMessages((prev) => [
            ...prev,
            { id: newId, content: "", status: "streaming" },
          ]);
        }

        // Buffer the token; schedule a single rAF flush
        tokenBufRef.current += raw.content;
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(flushTokens);
        }
      } else if (raw.type === "done") {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
          flushTokens();
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === activeIdRef.current ? { ...m, status: "complete" } : m
          )
        );
        activeIdRef.current = null;
        setIsTyping(false);
        setRouteInfo(null);
      } else if (raw.type === "error") {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === activeIdRef.current
              ? { ...m, content: raw.message ?? "Error", status: "error" }
              : m
          )
        );
        activeIdRef.current = null;
        setIsTyping(false);
        setRouteInfo(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawMessages]);

  // ── P0: SUPABASE POLLING FALLBACK ─────────────────────────────────────────
  // Every POLL_INTERVAL_MS, check if WS has been silent for >WS_SILENCE_THRESHOLD_MS.
  // If so, query /api/v1/runs to recover any in-flight or completed agent output.
  // Dedup by run_id to avoid rendering the same content twice when WS reconnects.
  useEffect(() => {
    const checkAndPoll = async () => {
      const silenceMs = Date.now() - lastWsActivityRef.current;
      const wsSilent  = silenceMs > WS_SILENCE_THRESHOLD_MS;

      setIsPolling(wsSilent);

      if (!wsSilent) return; // WS is active — poll not needed

      try {
        const res = await fetch(RUNS_ENDPOINT(sessionId));
        if (!res.ok) return;

        const rows: RunRow[] = await res.json();

        for (const row of rows) {
          // Skip runs we've already rendered via WS
          if (seenRunIdsRef.current.has(row.id)) continue;
          seenRunIdsRef.current.add(row.id);

          const content = row.chunk_text ?? "[No output — agent may still be running]";
          const status  = row.status === "complete" ? "complete"
                        : row.status === "error"    ? "error"
                        : "streaming";

          const recoveredId = `recovered-${row.id}`;

          setMessages((prev) => {
            // Avoid adding duplicate recovered message
            if (prev.some((m) => m.run_id === row.id)) return prev;
            return [
              ...prev,
              { id: recoveredId, content, status, run_id: row.id },
            ];
          });

          if (status !== "streaming") {
            setIsTyping(false);
          }
        }
      } catch {
        // Poll failure is non-fatal — WS will recover or user will reconnect
      }
    };

    pollTimerRef.current = setInterval(checkAndPoll, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [sessionId]);

  // ── CLEANUP ───────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
  }, []);

    // rawMessages grows monotonically — only process newest entries
  // Cleanup pending rAF on unmount
  const send = useCallback(
    (content: string) => {
      lastMsgRef.current = Date.now();  // reset silence timer on send
      // Sending resets the WS silence clock
      lastWsActivityRef.current = Date.now();
      wsSend(content, sessionId);
    },
    [wsSend, sessionId]
  );
  const clearMessages = useCallback(() => {
    setMessages([]);
    activeIdRef.current      = null;
    tokenBufRef.current      = "";
    seenRunIdsRef.current    = new Set();
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    setIsTyping(false);
    setRouteInfo(null);
  }, []);

  return { send, messages, isTyping, wsStatus, clearMessages, routeInfo };
    setIsPolling(false);
  void reconnecting; // consumed via reconnectAttempts from useWebSocket
  return { send, messages, isTyping, wsStatus, reconnectAttempts, clearMessages };
  return { send, messages, isTyping, wsStatus, clearMessages, isPolling };
  return { send, messages, isTyping, wsStatus, clearMessages };
}
