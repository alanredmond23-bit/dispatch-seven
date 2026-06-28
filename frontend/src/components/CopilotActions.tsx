// CopilotActions — context-aware agent action chips powered by CopilotKit
// Renders above the static ActionBar; additive, does not replace it.
// ponytail: static action list — dynamic context-aware suggestions when usage data exists

import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";

// ── Types ────────────────────────────────────────────────────────────────────

interface CopilotActionsProps {
  sessionId: string;
  sessionContext?: string;          // e.g. "legal" | "planning" | "scheduling"
  onSubmit: (prompt: string) => void;
  apiBase?: string;
}

// ── Inner component — must live inside <CopilotKit> ──────────────────────────

function ActionChips({
  sessionContext,
  onSubmit,
}: Pick<CopilotActionsProps, "sessionContext" | "onSubmit">) {
  // Collect triggered prompts from registered actions.
  // Each useCopilotAction call registers one chip; handler fires onSubmit.

  useCopilotAction({
    name: "ask_legal_agent",
    description: "Route this query to the legal analysis agent",
    parameters: [
      { name: "input", type: "string", description: "Query to send to the legal agent" },
    ],
    handler: ({ input }) => {
      onSubmit(`Ask the legal agent: ${input}`);
    },
    // Render a chip button that the user or the copilot can trigger
    render: ({ status, args, handler }) => (
      <ChipButton
        label="Ask legal agent"
        active={status === "inProgress"}
        hidden={sessionContext ? !["legal", "all"].includes(sessionContext) : false}
        onClick={() => handler({ input: args?.input ?? "" })}
      />
    ),
  });

  useCopilotAction({
    name: "decompose_goal",
    description: "Break the current goal into a structured task DAG",
    parameters: [
      { name: "input", type: "string", description: "Goal to decompose" },
    ],
    handler: ({ input }) => {
      onSubmit(`Decompose this goal into actionable steps: ${input}`);
    },
    render: ({ status, args, handler }) => (
      <ChipButton
        label="Decompose this goal"
        active={status === "inProgress"}
        hidden={sessionContext ? !["planning", "all"].includes(sessionContext) : false}
        onClick={() => handler({ input: args?.input ?? "" })}
      />
    ),
  });

  useCopilotAction({
    name: "schedule_followup",
    description: "Set a follow-up reminder tied to this session",
    parameters: [
      { name: "input", type: "string", description: "What to follow up on" },
    ],
    handler: ({ input }) => {
      onSubmit(`Schedule a follow-up for: ${input}`);
    },
    render: ({ status, args, handler }) => (
      <ChipButton
        label="Schedule follow-up"
        active={status === "inProgress"}
        hidden={sessionContext ? !["scheduling", "all"].includes(sessionContext) : false}
        onClick={() => handler({ input: args?.input ?? "" })}
      />
    ),
  });

  useCopilotAction({
    name: "check_cost",
    description: "Report current token usage and estimated cost for this session",
    parameters: [],
    handler: () => {
      onSubmit("Check the cost and token usage for this session");
    },
    render: ({ status, handler }) => (
      <ChipButton
        label="Check cost"
        active={status === "inProgress"}
        hidden={false}
        onClick={() => handler({})}
      />
    ),
  });

  useCopilotAction({
    name: "search_memory",
    description: "Search persistent memory for relevant context",
    parameters: [
      { name: "input", type: "string", description: "Memory search query" },
    ],
    handler: ({ input }) => {
      onSubmit(`Search memory for: ${input}`);
    },
    render: ({ status, args, handler }) => (
      <ChipButton
        label="Search memory"
        active={status === "inProgress"}
        hidden={false}
        onClick={() => handler({ input: args?.input ?? "" })}
      />
    ),
  });

  return null; // chips render via useCopilotAction render props
}

// ── Chip button ───────────────────────────────────────────────────────────────

function ChipButton({
  label,
  active,
  hidden,
  onClick,
}: {
  label: string;
  active: boolean;
  hidden: boolean;
  onClick: () => void;
}) {
  if (hidden) return null;
  return (
    <button
      onClick={onClick}
      disabled={active}
      style={{
        padding: "6px 14px",
        background: active ? "#1e293b" : "#0f172a",
        color: active ? "#64748b" : "#38bdf8",
        border: "1px solid #0ea5e9",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: "11px",
        letterSpacing: "0.06em",
        cursor: active ? "default" : "pointer",
        opacity: active ? 0.6 : 1,
        transition: "opacity 0.15s",
      }}
    >
      {active ? "..." : `⚡ ${label}`}
    </button>
  );
}

// ── Public export — wraps with CopilotKit provider ───────────────────────────

export default function CopilotActions({
  sessionId,
  sessionContext,
  onSubmit,
  apiBase = "/api",
}: CopilotActionsProps) {
  return (
    <CopilotKit runtimeUrl={`${apiBase}/copilot`}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
          paddingBottom: "6px",
        }}
      >
        <ActionChips sessionContext={sessionContext} onSubmit={onSubmit} />
      </div>
    </CopilotKit>
  );
}
