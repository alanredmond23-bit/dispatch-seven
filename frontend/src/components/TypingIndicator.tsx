// TypingIndicator — three animated dots shown while agent is streaming.
// Uses D7 design system: accent color dots, CSS vars for timing.
// Zero DOM cost when hidden (returns null — no layout box).

interface TypingIndicatorProps {
  isTyping: boolean;
}

export function TypingIndicator({ isTyping }: TypingIndicatorProps) {
  if (!isTyping) return null;

  return (
    <div className="d7-typing-dots" aria-label="Agent is typing" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}
