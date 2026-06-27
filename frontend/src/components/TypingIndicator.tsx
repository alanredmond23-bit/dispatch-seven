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

  return (
    <div className="d7-typing-dots" aria-label="Agent is typing" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}
