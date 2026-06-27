// Citation extraction and CourtListener/Cornell verification for legal agent outputs.
// Ponytail: regex extraction — ML-based citation detection when volume justifies it
// Ponytail: CourtListener + Cornell — add Westlaw/Lexis when enterprise key available

const TIMEOUT_MS = 3_000;

// ── PATTERNS ─────────────────────────────────────────────────────────────────

// Case names: "Smith v. Jones" — two capitalized words around v./v
const CASE_PATTERN = /\b([A-Z][A-Za-z\s,.']+)\s+v\.?\s+([A-Z][A-Za-z\s,.']+?)(?=,|\s+\d|\s+\(|[;.]|$)/g;

// Statute refs: 18 U.S.C. § 1001, § 523(a)(2)
const STATUTE_PATTERN = /\b(?:\d+\s+U\.?S\.?C\.?\s*)?§§?\s*\d[\d()\w.-]*/g;

// Docket numbers: 5:24-cr-00376, 4:24-bk-13093, AP 25-00254
const DOCKET_PATTERN = /\b(?:AP\s+)?\d{1,2}:\d{2}-(?:cr|bk|cv|ap|mc)-\d{4,6}(?:-[A-Z]+)?\b|\bAP\s+\d{2}-\d{5}\b/gi;

// ── SENTENCE UTIL ─────────────────────────────────────────────────────────────
function sentenceContaining(text: string, match: string): string {
  const idx = text.indexOf(match);
  if (idx === -1) return match;
  const before = text.lastIndexOf(".", idx);
  const start = before === -1 ? 0 : before + 1;
  const after = text.indexOf(".", idx + match.length);
  const end = after === -1 ? text.length : after + 1;
  return text.slice(start, end).trim();
}

// ── EXTRACT ───────────────────────────────────────────────────────────────────
export function extractCitations(
  text: string
): { claim: string; citation: string; verified: boolean }[] {
  const results: { claim: string; citation: string; verified: boolean }[] = [];
  const seen = new Set<string>();

  const add = (citation: string, claim: string) => {
    const key = citation.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    results.push({ claim: claim.trim(), citation: key, verified: false });
  };

  let m: RegExpExecArray | null;

  const caseRe = new RegExp(CASE_PATTERN.source, "g");
  while ((m = caseRe.exec(text)) !== null) {
    add(m[0].trim(), sentenceContaining(text, m[0]));
  }

  const statuteRe = new RegExp(STATUTE_PATTERN.source, "g");
  while ((m = statuteRe.exec(text)) !== null) {
    add(m[0].trim(), sentenceContaining(text, m[0]));
  }

  const docketRe = new RegExp(DOCKET_PATTERN.source, "gi");
  while ((m = docketRe.exec(text)) !== null) {
    add(m[0].trim(), sentenceContaining(text, m[0]));
  }

  return results;
}

// ── VERIFY ────────────────────────────────────────────────────────────────────
export async function verifyCitation(
  citation: string
): Promise<{ verified: boolean; url?: string; excerpt?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Dockets — not verifiable without PACER; always unverified
    if (/\d{1,2}:\d{2}-(?:cr|bk|cv)/i.test(citation) || /AP\s+\d/i.test(citation)) {
      clearTimeout(timer);
      return { verified: false };
    }

    // Statute — query Cornell LII (public, no auth required)
    if (/§/.test(citation) || /U\.?S\.?C\.?/i.test(citation)) {
      const query = encodeURIComponent(citation);
      const url = `https://www.law.cornell.edu/search/site/${query}`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      return res.ok ? { verified: true, url } : { verified: false };
    }

    // Case name — query CourtListener opinions API
    const apiKey = process.env.COURTLISTENER_API_KEY ?? "";
    const q = encodeURIComponent(citation.replace(/,.*$/, "").trim());
    const clUrl = `https://www.courtlistener.com/api/rest/v4/search/?q=${q}&type=o`;
    const res = await fetch(clUrl, {
      headers: apiKey ? { Authorization: `Token ${apiKey}` } : {},
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return { verified: false };
    const data = (await res.json()) as {
      count?: number;
      results?: { absolute_url?: string; caseName?: string }[];
    };
    if ((data.count ?? 0) > 0 && data.results?.length) {
      const hit = data.results[0];
      return {
        verified: true,
        url: hit.absolute_url ? `https://www.courtlistener.com${hit.absolute_url}` : undefined,
        excerpt: hit.caseName,
      };
    }
    return { verified: false };
  } catch {
    // Timeout or network failure — fail safe
    clearTimeout(timer);
    return { verified: false };
  }
}
