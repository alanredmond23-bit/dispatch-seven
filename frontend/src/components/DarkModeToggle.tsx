// DarkModeToggle — ghost button that cycles dark/system/light.
// Uses .d7-btn-ghost from design system.
// D7 is dark-first so "dark" is the default and preferred mode.

import { useState, useEffect } from "react";

type ColorScheme = "dark" | "light" | "system";

const ICONS: Record<ColorScheme, string> = {
  dark:   "◐",
  light:  "○",
  system: "◑",
};

const LABELS: Record<ColorScheme, string> = {
  dark:   "Dark",
  light:  "Light",
  system: "System",
};

function getNext(current: ColorScheme): ColorScheme {
  const order: ColorScheme[] = ["dark", "system", "light"];
  return order[(order.indexOf(current) + 1) % order.length];
}

export function DarkModeToggle() {
  const [scheme, setScheme] = useState<ColorScheme>(() => {
    return (localStorage.getItem("d7-color-scheme") as ColorScheme) ?? "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    localStorage.setItem("d7-color-scheme", scheme);

    if (scheme === "dark") {
      root.setAttribute("data-theme", "dark");
    } else if (scheme === "light") {
      root.setAttribute("data-theme", "light");
    } else {
      root.removeAttribute("data-theme");
    }
  }, [scheme]);

  return (
    <button
      className="d7-btn d7-btn-ghost d7-btn-sm"
      onClick={() => setScheme(getNext(scheme))}
      title={`Color scheme: ${LABELS[scheme]}`}
      aria-label={`Switch color scheme (current: ${LABELS[scheme]})`}
      style={{ fontFamily: "var(--d7-font-sans)", gap: "4px" }}
    >
      <span style={{ fontFamily: "monospace" }}>{ICONS[scheme]}</span>
      <span style={{ fontFamily: "var(--d7-font-mono)", fontSize: "var(--d7-text-xs)", letterSpacing: "var(--d7-tracking-wide)" }}>
        {LABELS[scheme].toUpperCase()}
      </span>
    </button>
  );
}
