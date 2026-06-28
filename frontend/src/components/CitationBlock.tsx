// CitationBlock — parses the "---\n**CITATIONS**\n" block appended by the
// legal agent citation pipeline and renders it as a collapsible card.
// Uses D7 design system CSS classes (components.css).

import { useState } from "react";

export interface ParsedCitation {
  text: string;          // raw citation line
  citation: string;      // authority name/reference
  verified: boolean;     // CourtListener/Cornell confirmed
  url?: string;          // link if verified
}

// ── PARSER ────────────────────────────────────────────────────────────────────
const BLOCK_MARKER = "---\n**CITATIONS**\n";

/**
 * Split message text into body and citation block.
 * Returns { body, citations } where citations is empty if no block found.
 */
export function parseMessageCitations(text: string): {
  body: string;
  citations: ParsedCitation[];
  noneExtracted: boolean;
} {
  const idx = text.indexOf(BLOCK_MARKER);
  if (idx === -1) {
    return { body: text, citations: [], noneExtracted: false };
  }

  const body = text.slice(0, idx).trim();
  const block = text.slice(idx + BLOCK_MARKER.length).trim();

  // Check for the "no citations" warning
  if (block.startsWith("⚠️ No citations")) {
    return { body, citations: [], noneExtracted: true };
  }

  const citations: ParsedCitation[] = block
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((line) => {
      // Line format: "- <citation> ✓ — <url>"  or  "- <citation> [UNVERIFIED]"
      const raw = line.slice(2); // strip "- "
      const verified = raw.includes(" ✓");
      const urlMatch = raw.match(/ — (https?:\/\/\S+)/);
      const url = urlMatch?.[1];
      // Strip verification markers and url to get clean citation text
      const citation = raw
        .replace(" ✓", "")
        .replace(" [UNVERIFIED]", "")
        .replace(urlMatch?.[0] ?? "", "")
        .trim();
      return { text: raw, citation, verified, url };
    });

  return { body, citations, noneExtracted: false };
}

// ── COMPONENT ─────────────────────────────────────────────────────────────────
interface CitationBlockProps {
  messageText: string;
}

export default function CitationBlock({ messageText }: CitationBlockProps) {
  const [open, setOpen] = useState(false);
  const { citations, noneExtracted } = parseMessageCitations(messageText);

  // No block present — render nothing
  if (!noneExtracted && citations.length === 0) return null;

  const verifiedCount = citations.filter((c) => c.verified).length;
  const totalCount = citations.length;

  // ── Red banner: no citations extracted ───────────────────────────────────
  if (noneExtracted) {
    return (
      <div className="d7-citation-block__no-citations">
        ⚠ NO CITATIONS EXTRACTED — legal claims must be verified manually
      </div>
    );
  }

  // ── Collapsible citation card ─────────────────────────────────────────────
  return (
    <div className="d7-citation-block" style={{ marginTop: "8px" }}>
      {/* Toggle header */}
      <button
        className="d7-citation-block__header"
        onClick={() => setOpen((o) => !o)}
        style={{ borderBottom: open ? "1px solid var(--d7-border)" : "none" }}
      >
        <span>CITATIONS ({totalCount})</span>
        <span style={{ color: verifiedCount === totalCount ? "var(--d7-success)" : "var(--d7-warning)" }}>
          {verifiedCount}/{totalCount} VERIFIED {open ? "▴" : "▾"}
        </span>
      </button>

      {/* Citation list */}
      {open && (
        <div className="d7-citation-block__body">
          {citations.map((c, i) => (
            <div className="d7-citation-block__item" key={i}>
              {/* Status badge */}
              <span className={c.verified ? "d7-citation-block__status--verified" : "d7-citation-block__status--unverified"}>
                {c.verified ? "✓" : "⚠"}
              </span>

              {/* Citation text / link */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {c.verified && c.url ? (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontFamily: "var(--d7-font-mono)",
                      fontSize: "var(--d7-text-sm)",
                      wordBreak: "break-all",
                    }}
                  >
                    {c.citation}
                  </a>
                ) : (
                  <span
                    style={{
                      fontFamily: "var(--d7-font-mono)",
                      fontSize: "var(--d7-text-sm)",
                      color: c.verified ? "var(--d7-text)" : "var(--d7-warning)",
                      wordBreak: "break-word",
                    }}
                  >
                    {c.citation}
                    {!c.verified && (
                      <span style={{ marginLeft: "6px", fontSize: "var(--d7-text-xs)", letterSpacing: "var(--d7-tracking-wide)" }}>
                        [UNVERIFIED]
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
