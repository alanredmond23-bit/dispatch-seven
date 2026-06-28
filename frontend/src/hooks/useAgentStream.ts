// useAgentStream — wraps useWebSocket with smooth token buffering + typing indicator.
// Uses rAF (16ms) to batch token appends and avoid layout thrash.
// Message status: 'streaming' | 'complete' | 'error'
//
// Turn 2 additions:
//  - reconnectAttempts + wsStatus exposed for ConnectionBadge
//  - Supabase polling fallback: if WS is silent for >5s while isTyping=true,
//    polls GET /api/v1/runs?session_id=X and surfaces a completed run the WS missed.
//    Fixes the Cowork SendUserMessage silent-drop bug.

import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "./useWebSocket";

export type MessageStatus = "idle" | "streaming" | "complete" | "error";

export interface AgentMessage {
  id:      string;
  content: string;
  status:  MessageStatus;
}

export interface UseAgentStreamReturn {
  send:              (content: string) => void;
  messages:          AgentMessage[];
  isTyping:          boolean;
  wsStatus:          "connecting" | "open" | "closed" | "error";
  reconnectAttempts: number;
  clearMessages:     () => void;
}

const API_BASE     = (import.meta as { env: Record<string, string> }).env?.VITE_API_URL ?? "";
const SILENCE_MS   = 5_000;   // poll fallback fires after 5s silence while isTyping

export function useAgentStream(sessionId: string): UseAgentStreamReturn {
  const [reconnecting, setReconnecting] = useState(false);

  const handleReconnecting = useCallback(() => setReconnecting(true), []);

  const { send: wsSend, messages: rawMessages, status: wsStatus, reconnectAttempts } =
    useWebSocket(sessionId, handleReconnecting);

  const [messages,  setMessages]  = useState<AgentMessage[]>([]);
  const [isTyping,  setIsTyping]  = useState(false);

  const tokenBufRef  = useRef<string>("");
  const rafRef       = useRef<number | null>(null);
  const activeIdRef  = useRef<string | null>(null);

  // Polling fallback: tracks last WS message timestamp; fires if >SILENCE_MS while isTyping
  const lastMsgRef     = useRef<number>(Date.now());
  const pollTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const polledRunRef   = useRef<string | null>(null);  // last run id surfaced by polling
  const isTypingRef    = useRef(false);
  isTypingRef.current  = isTyping;

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
      lastMsgRef.current = Date.now();  // reset silence timer on any WS message

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
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawMessages]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const send = useCallback(
    (content: string) => {
      lastMsgRef.current = Date.now();  // reset silence timer on send
      wsSend(content, sessionId);
    },
    [wsSend, sessionId]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    activeIdRef.current  = null;
    tokenBufRef.current  = "";
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsTyping(false);
  }, []);

  void reconnecting; // consumed via reconnectAttempts from useWebSocket

  return { send, messages, isTyping, wsStatus, reconnectAttempts, clearMessages };
}
