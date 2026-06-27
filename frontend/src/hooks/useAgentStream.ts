// useAgentStream.ts — thin hook wrapping wsSchedule; exposes isTyping for UI
// Ponytail: no state machine, just isTyping bool + results
import { useState, useCallback } from "react";
import { generateScheduleViaWs } from "../lib/wsSchedule";

interface UseAgentStreamResult {
  isTyping: boolean;
  run: (prompt: string, sessionId?: string) => Promise<string | null>;
}

export function useAgentStream(): UseAgentStreamResult {
  const [isTyping, setIsTyping] = useState(false);

  const run = useCallback(async (prompt: string, sessionId?: string): Promise<string | null> => {
    setIsTyping(true);
    try {
      const result = await generateScheduleViaWs(prompt, sessionId);
      return result;
    } catch (err) {
      console.error("[useAgentStream]", err);
      return null;
    } finally {
      setIsTyping(false);
    }
  }, []);

  return { isTyping, run };
}
