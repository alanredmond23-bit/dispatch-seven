// RESEARCH agent — Turn 8
// Runs 3-5 Tavily searches, synthesises via claude-sonnet-4-6, returns structured JSON.
// CITE/UNVERIFIED pattern mirrors legal.ts discipline.

export const RESEARCH_SYSTEM = `You are a web research and synthesis agent. Given a research question or topic, you search the web and synthesize findings into a structured report. Follow these rules:
- Every factual claim must have an inline citation: [CITE: source_url]
- Unverified or single-source claims are tagged [UNVERIFIED]
- Return structured JSON: { summary: string, findings: Finding[], citations: Citation[], confidence: 'high'|'medium'|'low' }
- Finding: { claim: string, evidence: string, source_url: string, verified: boolean }
- Citation: { id: number, url: string, title: string, snippet: string }
- confidence is 'high' when 3+ independent sources corroborate, 'medium' for 2 sources, 'low' for 1 or unverified
- Do not invent sources. If uncertain, tag [UNVERIFIED] and set verified: false`.trim();

export interface Finding {
  claim: string;
  evidence: string;
  source_url: string;
  verified: boolean;
}

export interface Citation {
  id: number;
  url: string;
  title: string;
  snippet: string;
}

export interface ResearchResult {
  summary: string;
  findings: Finding[];
  citations: Citation[];
  confidence: 'high' | 'medium' | 'low';
}

export interface ResearchInput {
  query: string;
  session_id: string;
}

// ── Search result type (mirrors search-runner.ts) ──────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Derive 3-5 sub-queries from the main query. Keeps it simple — no API call. */
function buildSubQueries(query: string): string[] {
  const base = query.trim();
  return [
    base,
    `${base} overview`,
    `${base} latest developments`,
    `${base} analysis`,
    `${base} evidence research`,
  ].slice(0, 5);
}

/** Format search results into a prompt block for Claude. */
function formatResultsForPrompt(results: SearchResult[]): string {
  if (results.length === 0) return "No search results available.";
  return results
    .map(
      (r, i) =>
        `[${i + 1}] Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}\nScore: ${r.score}`
    )
    .join("\n\n");
}

/** Parse Claude's JSON response, tolerating markdown fences. */
function parseClaudeResponse(text: string): ResearchResult {
  const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  try {
    return JSON.parse(cleaned) as ResearchResult;
  } catch {
    // Fallback: return a low-confidence result with the raw text as summary
    return {
      summary: text.slice(0, 500),
      findings: [],
      citations: [],
      confidence: "low",
    };
  }
}

// ── Main export ────────────────────────────────────────────────────────────

export async function runResearchAgent(input: ResearchInput): Promise<ResearchResult> {
  // Import search-runner dynamically to avoid circular issues and keep agents/ clean
  // search-runner lives in backend/src/lib/ but agents/ is at root — use process path
  // Pattern: inline fetch to Tavily identical to search-runner.ts
  const apiKey = process.env.TAVILY_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not set");

  const subQueries = buildSubQueries(input.query);
  const allResults: SearchResult[] = [];

  // Run searches in parallel
  if (apiKey) {
    const searchPromises = subQueries.map(async (q) => {
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            query: q,
            max_results: 5,
            search_depth: "advanced",
          }),
        });
        if (!res.ok) return [];
        const data = (await res.json()) as {
          results?: Array<{ title: string; url: string; content: string; score: number }>;
        };
        return (data.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
          score: r.score,
        }));
      } catch {
        return [];
      }
    });

    const batches = await Promise.all(searchPromises);
    const seen = new Set<string>();
    for (const batch of batches) {
      for (const r of batch) {
        if (!seen.has(r.url)) {
          seen.add(r.url);
          allResults.push(r);
        }
      }
    }
    allResults.sort((a, b) => b.score - a.score);
  }

  // Build prompt for Claude
  const resultsBlock = formatResultsForPrompt(allResults.slice(0, 15));
  const userPrompt = `Research query: ${input.query}

Web search results:
${resultsBlock}

Based on these search results, produce a structured research report. Return ONLY valid JSON matching this schema:
{
  "summary": "concise paragraph summarizing key findings",
  "findings": [
    { "claim": "specific factual claim", "evidence": "supporting detail", "source_url": "url from results", "verified": true|false }
  ],
  "citations": [
    { "id": 1, "url": "source url", "title": "source title", "snippet": "relevant excerpt" }
  ],
  "confidence": "high"|"medium"|"low"
}

Rules:
- Only cite URLs that appear in the search results above
- Mark verified: true only when multiple sources corroborate
- Tag single-source claims [UNVERIFIED] in the claim text
- No markdown fences, no explanation — JSON only`;

  // Call Claude
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: RESEARCH_SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }

  const json = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const text = json.content.find((b) => b.type === "text")?.text ?? "{}";
  return parseClaudeResponse(text);
}
