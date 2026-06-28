// DarkModeToggle.tsx — toggles .dark class on <html>, persists to localStorage
// Ponytail: sun/moon emoji, no icon lib, ~30 lines
import { useState, useEffect } from "react";

export default function DarkModeToggle() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("theme");
    // Default to dark (app is dark-first)
    return saved ? saved === "dark" : true;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <button
      onClick={() => setDark(d => !d)}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        background: "none",
        border: "1px solid #1a2540",
        color: "#4a5568",
        padding: "4px 8px",
        cursor: "pointer",
        fontFamily: "system-ui",
        fontSize: "14px",
        lineHeight: 1,
        borderRadius: "4px",
      }}
      aria-label="Toggle dark mode"
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}
