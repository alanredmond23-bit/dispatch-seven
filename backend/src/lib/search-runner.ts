// search-runner.ts — Tavily search wrapper for Turn 8 RESEARCH agent
// TAVILY_API_KEY from process.env — never hardcoded
// runTavilySearch: single query → SearchResult[]
// runMultiSearch:  parallel queries, deduplicated by URL

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score: number;
}

interface TavilyResponse {
  results?: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
  }>;
  error?: string;
}

/** Single Tavily search. Returns [] on error (never throws). */
export async function runTavilySearch(
  query: string,
  maxResults: number = 5
): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn("[search-runner] TAVILY_API_KEY not set — returning empty results");
    return [];
  }

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: "advanced",
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[search-runner] Tavily ${res.status}: ${body}`);
      return [];
    }

    const data = (await res.json()) as TavilyResponse;
    if (data.error) {
      console.error(`[search-runner] Tavily error: ${data.error}`);
      return [];
    }

    return (data.results ?? []).map((r) => ({
      title:   r.title,
      url:     r.url,
      snippet: r.content,
      score:   r.score,
    }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[search-runner] fetch error: ${msg}`);
    return [];
  }
}

/**
 * Run multiple searches in parallel and deduplicate by URL.
 * Results sorted by descending score.
 */
export async function runMultiSearch(queries: string[]): Promise<SearchResult[]> {
  const results = await Promise.all(queries.map((q) => runTavilySearch(q)));
  const flat = results.flat();

  // Deduplicate by URL — keep highest-score occurrence
  const byUrl = new Map<string, SearchResult>();
  for (const r of flat) {
    const existing = byUrl.get(r.url);
    if (!existing || r.score > existing.score) {
      byUrl.set(r.url, r);
    }
  }

  return [...byUrl.values()].sort((a, b) => b.score - a.score);
}
