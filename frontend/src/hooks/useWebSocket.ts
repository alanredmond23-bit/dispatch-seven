// useWebSocket — native WebSocket hook with auto-reconnect and ping/pong
// No external libs. Connects to D7 backend /ws?session_id=<id>
//
// Protocol handled here:
//   sends:    { type: "message", content, session_id }
//             { type: "pong" }                          (auto, on ping)
//   receives: { type: "token",   content }
//             { type: "done",    session_id }
//             { type: "ping" }
//             { type: "error",   message }

import { useCallback, useEffect, useRef, useState } from "react";

export type WsStatus = "connecting" | "open" | "closed" | "error";

export interface WsMessage {
  type: "token" | "done" | "error" | "ping";
  content?: string;
  session_id?: string;
  message?: string;
}

export interface UseWebSocketReturn {
  /** Send a user message — content is the full prompt string */
  send: (content: string, sessionId?: string) => void;
  /** All protocol messages received since mount (or last clear) */
  messages: WsMessage[];
  /** Current connection status */
  status: WsStatus;
}

// Build the WS URL from VITE_WS_URL or fall back to current host
function resolveWsUrl(sessionId: string): string {
  const base =
    // Vite injects env vars at build time
    (typeof import.meta !== "undefined" && (import.meta as Record<string, unknown>).env
      ? ((import.meta as { env: Record<string, string> }).env.VITE_WS_URL ?? "")
      : "");

  if (base) {
    const url = new URL("/ws", base);
    url.searchParams.set("session_id", sessionId);
    // wss:// in production, ws:// in dev
    url.protocol = base.startsWith("https") ? "wss:" : "ws:";
    return url.toString();
  }

  // Fallback: derive from current page origin
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws?session_id=${encodeURIComponent(sessionId)}`;
}

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS  = 30_000;

export function useWebSocket(sessionId: string): UseWebSocketReturn {
  const [status,   setStatus]   = useState<WsStatus>("connecting");
  const [messages, setMessages] = useState<WsMessage[]>([]);

  const wsRef      = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadRef    = useRef(false);   // set true on unmount to stop reconnect

  const connect = useCallback(() => {
    if (deadRef.current) return;

    const url = resolveWsUrl(sessionId);
    const ws  = new WebSocket(url);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      attemptRef.current = 0;           // reset backoff on successful connect
      setStatus("open");
    };

    ws.onmessage = (evt) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(evt.data as string) as WsMessage;
      } catch {
        return;
      }

      // Auto-respond to heartbeat pings immediately
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;   // don't surface ping to consumers
      }

      setMessages((prev) => [...prev, msg]);
    };

    ws.onerror = () => {
      setStatus("error");
    };

    ws.onclose = (evt) => {
      setStatus("closed");
      wsRef.current = null;

      if (deadRef.current) return;
      if (evt.wasClean && evt.code === 1000) return;  // intentional close

      // Exponential backoff reconnect
      const attempt = ++attemptRef.current;
      const delay   = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
      console.log(`[WS] reconnect attempt ${attempt} in ${delay}ms`);
      timerRef.current = setTimeout(connect, delay);
    };
  }, [sessionId]);

  useEffect(() => {
    deadRef.current = false;
    connect();

    return () => {
      deadRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close(1000, "unmount");
    };
  }, [connect]);

  const send = useCallback(
    (content: string, sid?: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("[WS] send attempted while not open — message dropped");
        return;
      }
      ws.send(
        JSON.stringify({
          type:       "message",
          content,
          session_id: sid ?? sessionId,
        })
      );
    },
    [sessionId]
  );

  return { send, messages, status };
}
