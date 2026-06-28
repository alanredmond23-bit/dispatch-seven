// TypingIndicator.tsx — animated three-dot indicator shown while agent streams
// Ponytail: CSS keyframe only, no library
import { useEffect, useState } from "react";

interface Props { visible: boolean; }

export default function TypingIndicator({ visible }: Props) {
  const [show, setShow] = useState(false);

  // Slight delay so it doesn't flash on instant responses
  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => setShow(true), 200);
      return () => clearTimeout(t);
    } else {
      setShow(false);
    }
  }, [visible]);

  if (!show) return null;

  return (
    <>
      <style>{`
        @keyframes d7-dot {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40%            { opacity: 1;   transform: scale(1);   }
        }
        .d7-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #1d4ed8; animation: d7-dot 1.2s ease-in-out infinite; }
        .d7-dot:nth-child(2) { animation-delay: 0.2s; }
        .d7-dot:nth-child(3) { animation-delay: 0.4s; }
      `}</style>
      <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "10px 16px", marginBottom: "8px" }}>
        <span className="d7-dot" />
        <span className="d7-dot" />
        <span className="d7-dot" />
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: "#4a5568", marginLeft: "6px", letterSpacing: "0.12em" }}>
          AGENT THINKING
        </span>
      </div>
    </>
// TypingIndicator — three animated dots shown while agent is streaming.
// Zero DOM cost when hidden: display:none (not visibility:hidden — no layout box).
// No library. Pure CSS keyframe via <style> tag injected once.
// Ponytail: one component, one job.
import { useEffect } from "react";
const STYLE_ID = "d7-typing-indicator-style";
const CSS = `
@keyframes d7-dot-bounce {
  0%, 80%, 100% { transform: translateY(0);   opacity: 0.4; }
  40%            { transform: translateY(-5px); opacity: 1;   }
}
.d7-typing-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
}
.d7-typing-dots span {
  display: inline-block;
  width:  7px;
  height: 7px;
  border-radius: 50%;
  background: #4a5568;
  animation: d7-dot-bounce 1.2s ease-in-out infinite;
}
.d7-typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.d7-typing-dots span:nth-child(3) { animation-delay: 0.4s; }
`;
function ensureStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}
interface TypingIndicatorProps {
  isTyping: boolean;
}
export function TypingIndicator({ isTyping }: TypingIndicatorProps) {
  // Inject CSS once on mount
  useEffect(() => { ensureStyle(); }, []);
  // display:none — zero layout cost when hidden
  if (!isTyping) return null;
    <div className="d7-typing-dots" aria-label="Agent is typing" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}
