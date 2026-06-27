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
  );
}
