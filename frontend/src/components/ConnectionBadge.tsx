// ConnectionBadge — pure-CSS connection status indicator.
// Props: status connected|reconnecting|disconnected, attempts (shown on reconnecting).
// Ponytail: no icon library, inline keyframes injected once.

import { useEffect } from "react";

export type ConnStatus = "connected" | "reconnecting" | "disconnected";

const STYLE_ID = "d7-conn-badge-css";

const DOT_CSS = `
@keyframes d7-spin { to { transform: rotate(360deg); } }
.d7-dot-connected    { width:8px;height:8px;border-radius:50%;background:#16a34a; }
.d7-dot-disconnected { width:8px;height:8px;border-radius:50%;background:#dc2626; }
.d7-dot-reconnecting {
  width:8px;height:8px;border-radius:50%;
  border:2px solid #d97706; border-top-color:transparent;
  animation: d7-spin 0.8s linear infinite;
}
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = DOT_CSS;
  document.head.appendChild(el);
}

const LABELS: Record<ConnStatus, string> = {
  connected:    "Connected",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
};

const TEXT_COLORS: Record<ConnStatus, string> = {
  connected:    "#16a34a",
  reconnecting: "#d97706",
  disconnected: "#dc2626",
};

export default function ConnectionBadge({
  status,
  attempts,
}: {
  status: ConnStatus;
  attempts?: number;
}) {
  useEffect(() => { injectStyles(); }, []);

  const label =
    status === "reconnecting" && attempts && attempts > 0
      ? `Reconnecting... (attempt ${attempts})`
      : LABELS[status];

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "6px",
      fontFamily: "'JetBrains Mono', monospace", fontSize: "9px",
      color: TEXT_COLORS[status], letterSpacing: "0.1em",
    }}>
      <div className={`d7-dot-${status}`} />
      <span>{label}</span>
    </div>
  );
}
