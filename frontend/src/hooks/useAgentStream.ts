// useAgentStream — wraps useWebSocket with smooth token buffering + typing indicator.
// Uses rAF (16ms) to batch token appends and avoid layout thrash.
// Message status: 'streaming' | 'complete' | 'error'
// Ponytail: basic WS + rAF buffer. Add readDataStreamResponse when SSE transport is wired.

import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "./useWebSocket";

export type MessageStatus = "idle" | "streaming" | "complete" | "error";

export interface AgentMessage {
  id:      string;
  content: string;
  status:  MessageStatus;
}

export interface RouteInfo {
  agent: string;
  model: string;
}

export interface UseAgentStreamReturn {
  /** Send a prompt to the agent */
  send:        (content: string) => void;
  /** Fully assembled messages (complete + in-progress) */
  messages:    AgentMessage[];
  /** True while the current response is streaming */
  isTyping:    boolean;
  /** WebSocket connection status */
  wsStatus:    "connecting" | "open" | "closed" | "error";
  /** Clear message history */
  clearMessages: () => void;
  /** Active route: which agent + model is handling current stream */
  routeInfo:   RouteInfo | null;
}

export function useAgentStream(sessionId: string): UseAgentStreamReturn {
  const { send: wsSend, messages: rawMessages, status: wsStatus } = useWebSocket(sessionId);

  const [messages,  setMessages]  = useState<AgentMessage[]>([]);
  const [isTyping,  setIsTyping]  = useState(false);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);

  // Token buffer for rAF batching — avoids one setState per token
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

  // Process raw WS messages as they arrive
  useEffect(() => {
    for (const raw of rawMessages) {
      if (raw.type === "route" && raw.agent) {
        setRouteInfo({ agent: raw.agent, model: raw.model ?? "" });
      } else if (raw.type === "token" && raw.content !== undefined) {
        if (!activeIdRef.current) {
          // First token of a new response — create message row
          const newId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          activeIdRef.current = newId;
          setIsTyping(true);
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
        // Ensure any buffered tokens are flushed synchronously before marking complete
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
    // rawMessages grows monotonically — only process newest entries
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawMessages]);

  // Cleanup pending rAF on unmount
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const send = useCallback(
    (content: string) => {
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
    setRouteInfo(null);
  }, []);

  return { send, messages, isTyping, wsStatus, clearMessages, routeInfo };
}
