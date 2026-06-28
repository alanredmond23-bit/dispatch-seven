// classify.test.ts — domain classifier integration tests
// 10 sample messages → verify correct AgentDomain classification
// No mocks needed — classifier is pure keyword-match, zero API calls

import { describe, it, expect } from "vitest";
import { classifyMessage, type AgentDomain } from "../../lib/classifier.js";

// ── TEST MATRIX ───────────────────────────────────────────────────────────────
// Each entry: [input message, expected domain, human label for test name]
const CASES: [string, AgentDomain, string][] = [
  [
    "What is the status of case 5:24-cr-00376? Has Judge Schmehl set any new hearing dates?",
    "LEGAL",
    "federal criminal case number + judge name → LEGAL",
  ],
  [
    "Fix the TypeScript build error in the WebSocket handler — npm run build is failing",
    "CODE",
    "TypeScript + npm build failure → CODE",
  ],
  [
    "Research the latest AI agent frameworks — compare LangChain vs AutoGen vs CrewAI",
    "RESEARCH",
    "research/compare request → RESEARCH",
  ],
  [
    "Remind me about the court hearing deadline on September 14th 2026",
    "SCHEDULER",
    "reminder + deadline + date → SCHEDULER",
  ],
  [
    "What's the docket status in the bankruptcy case 4:24-bk-13093? When is the next hearing?",
    "LEGAL",
    "bankruptcy case number + hearing → LEGAL",
  ],
  [
    "Deploy the backend to Azure Container Apps — run docker build and push to ACR",
    "CODE",
    "deploy + docker → CODE",
  ],
  [
    "What are the upcoming deadlines for this week? Show me the schedule",
    "SCHEDULER",
    "upcoming deadlines + schedule → SCHEDULER",
  ],
  [
    "Find the latest research on Five9 call center software pricing and competitors",
    "RESEARCH",
    "find + latest + research + compare → RESEARCH",
  ],
  [
    "The subpoena response is due Thursday — create a reminder for Wednesday morning",
    "SCHEDULER",
    "due date + reminder → SCHEDULER (beats LEGAL by reminder keyword count)",
  ],
  [
    "Review this pull request — check for SQL injection vulnerabilities in the API endpoint",
    "CODE",
    "pull request + API endpoint review → CODE",
  ],
];

// ── TESTS ─────────────────────────────────────────────────────────────────────
describe("classifyMessage — domain routing", () => {
  for (const [message, expectedDomain, label] of CASES) {
    it(label, () => {
      const result = classifyMessage(message);
      expect(result).toBe(expectedDomain);
    });
  }

  // Edge cases
  it("returns ORCHESTRATOR for empty message", () => {
    expect(classifyMessage("")).toBe("ORCHESTRATOR");
  });

  it("returns ORCHESTRATOR for completely generic message", () => {
    expect(classifyMessage("Hello there")).toBe("ORCHESTRATOR");
  });

  it("is case-insensitive", () => {
    expect(classifyMessage("COURT HEARING FOR JUDGE SCHMEHL")).toBe("LEGAL");
    expect(classifyMessage("typescript build error")).toBe("CODE");
  });

  it("picks highest-score domain when multiple domains match", () => {
    // Message with both LEGAL and CODE keywords — whichever scores higher wins
    // "case" (LEGAL) + "api endpoint" (CODE) + "code review" (CODE) = CODE wins
    const multiDomain = "Can you code review the API endpoint for the legal case filing?";
    const result = classifyMessage(multiDomain);
    // Should be CODE (2 keywords) vs LEGAL (1 keyword "case")
    expect(result).toBe("CODE");
  });
});
