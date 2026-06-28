/**
 * D7 Design System — JS Token Exports
 * Use for dynamic styles (inline style objects, canvas drawing, chart colors).
 * CSS vars (tokens.css) are the source of truth.
 * These constants mirror tokens.css — keep in sync.
 */

export const colors = {
  // Backgrounds
  bg:         "#0A0A0F",
  surface:    "#111118",
  surface2:   "#16161F",
  surface3:   "#1C1C28",

  // Borders
  border:     "#1E1E2E",
  border2:    "#2A2A3E",
  borderFocus:"#5B6EF5",

  // Accent
  accent:     "#5B6EF5",
  accentHover:"#7B8EFF",
  accentMuted:"#2A3080",

  // Semantic
  success:    "#22C55E",
  warning:    "#F59E0B",
  error:      "#EF4444",
  legal:      "#DC2626",

  // Agent domains
  agentLegal:        "#DC2626",
  agentCode:         "#5B6EF5",
  agentResearch:     "#22C55E",
  agentOrchestrator: "#F59E0B",

  // Text
  text:       "#F0F0F6",
  text2:      "#8888AA",
  textMuted:  "#55557A",

  // Task status
  taskPending:"#444455",
  taskRunning:"#5B6EF5",
  taskDone:   "#22C55E",
  taskFailed: "#EF4444",
} as const;

export const fonts = {
  sans: "'Geist', 'Inter', system-ui, -apple-system, sans-serif",
  mono: "'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace",
} as const;

export const fontSizes = {
  xs:   "12px",
  sm:   "13px",
  base: "14px",
  md:   "16px",
  lg:   "18px",
  xl:   "24px",
  "2xl":"32px",
} as const;

export const spacing = {
  1:  "4px",
  2:  "8px",
  3:  "12px",
  4:  "16px",
  5:  "20px",
  6:  "24px",
  8:  "32px",
  10: "40px",
  12: "48px",
  16: "64px",
} as const;

export const radii = {
  sm:   "4px",
  base: "6px",
  md:   "8px",
  lg:   "12px",
  full: "9999px",
} as const;

/** Agent domain badge colors — use with AgentBadge */
export const agentColors: Record<string, string> = {
  LEGAL:        colors.agentLegal,
  CODE:         colors.agentCode,
  RESEARCH:     colors.agentResearch,
  ORCHESTRATOR: colors.agentOrchestrator,
};

/** Task status border colors */
export const taskStatusColors: Record<string, string> = {
  pending:  colors.taskPending,
  running:  colors.taskRunning,
  done:     colors.taskDone,
  failed:   colors.taskFailed,
};

/** Semantic inline style helper — returns a minimal style object */
export function surfaceStyle(elevated = false) {
  return {
    background: elevated ? colors.surface2 : colors.surface,
    border: `1px solid ${colors.border}`,
  };
}
