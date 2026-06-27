// wsSchedule — WebSocket-backed replacement for the direct Anthropic fetch
// in generateSchedule(). Sends the prompt to D7 backend /ws, accumulates
// streamed tokens, resolves with the full JSON string.
//
// Falls back to direct Anthropic API if VITE_WS_URL is not set and
// window.location.host is localhost (dev convenience only).

export function generateScheduleViaWs(
  prompt: string,
  sessionId: string,
  onToken?: (tok: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Build WS URL (same logic as useWebSocket but standalone so this
    // can be called outside a React component lifecycle)
    const base =
      (typeof import.meta !== "undefined" && (import.meta as Record<string, unknown>).env)
        ? ((import.meta as { env: Record<string, string> }).env.VITE_WS_URL ?? "")
        : "";

    let url: string;
    if (base) {
      const u = new URL("/ws", base);
      u.searchParams.set("session_id", sessionId);
      u.protocol = base.startsWith("https") ? "wss:" : "ws:";
      url = u.toString();
    } else {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      url = `${proto}//${window.location.host}/ws?session_id=${encodeURIComponent(sessionId)}`;
    }

    const ws = new WebSocket(url);
    let accumulated = "";
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      ws.close(1000, "done");
      if (err) reject(err);
      else resolve(accumulated);
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "message", content: prompt, session_id: sessionId }));
    };

    ws.onmessage = (evt) => {
      let msg: { type: string; content?: string; message?: string };
      try { msg = JSON.parse(evt.data as string); } catch { return; }

      switch (msg.type) {
        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;
        case "token":
          if (msg.content) {
            accumulated += msg.content;
            onToken?.(msg.content);
          }
          break;
        case "done":
          finish();
          break;
        case "error":
          finish(new Error(msg.message ?? "WS stream error"));
          break;
      }
    };

    ws.onerror = () => finish(new Error("WebSocket connection failed"));
    ws.onclose = (e) => {
      if (!settled) finish(new Error(`WebSocket closed unexpectedly (${e.code})`));
    };

    // Safety timeout — 60s max
    const guard = setTimeout(() => finish(new Error("Schedule request timed out")), 60_000);
    // Clear guard once settled
    const origFinish = finish;
    const wrappedFinish = (err?: Error) => { clearTimeout(guard); origFinish(err); };
    ws.onclose = (e) => { if (!settled) wrappedFinish(new Error(`WebSocket closed (${e.code})`)); };
    ws.onerror = () => wrappedFinish(new Error("WebSocket connection failed"));
    ws.onmessage = (evt) => {
      let msg: { type: string; content?: string; message?: string };
      try { msg = JSON.parse(evt.data as string); } catch { return; }
      switch (msg.type) {
        case "ping": ws.send(JSON.stringify({ type: "pong" })); break;
        case "token": if (msg.content) { accumulated += msg.content; onToken?.(msg.content); } break;
        case "done":  wrappedFinish(); break;
        case "error": wrappedFinish(new Error(msg.message ?? "WS error")); break;
      }
    };
  });
}
