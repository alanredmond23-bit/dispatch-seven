// CitationBlock — parses the "---\n**CITATIONS**\n" block appended by the
// legal agent citation pipeline and renders it as a collapsible card.
// Zero external deps — pure React + Tailwind.

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
      <div
        style={{
          marginTop: "8px",
          padding: "8px 12px",
          background: "#2d0a0a",
          border: "1px solid #dc2626",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: "11px",
          color: "#dc2626",
          letterSpacing: "0.08em",
        }}
      >
        ⚠ NO CITATIONS EXTRACTED — legal claims must be verified manually
      </div>
    );
  }

  // ── Collapsible citation card ─────────────────────────────────────────────
  return (
    <div style={{ marginTop: "8px", border: "1px solid #1a2540" }}>
      {/* Toggle header */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          background: "#090e1a",
          border: "none",
          borderBottom: open ? "1px solid #1a2540" : "none",
          padding: "8px 12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: "10px",
            color: "#94a3b8",
            letterSpacing: "0.15em",
          }}
        >
          CITATIONS ({totalCount})
        </span>
        <span
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: "10px",
            color: verifiedCount === totalCount ? "#16a34a" : "#d97706",
            letterSpacing: "0.1em",
          }}
        >
          {verifiedCount}/{totalCount} VERIFIED {open ? "▴" : "▾"}
        </span>
      </button>

      {/* Citation list */}
      {open && (
        <div style={{ background: "#050810", padding: "8px 12px" }}>
          {citations.map((c, i) => (
            <div
              key={i}
              style={{
                padding: "6px 0",
                borderBottom: i < citations.length - 1 ? "1px solid #1a2540" : "none",
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
              }}
            >
              {/* Status badge */}
              <span
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "10px",
                  color: c.verified ? "#16a34a" : "#d97706",
                  flexShrink: 0,
                  paddingTop: "1px",
                }}
              >
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
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: "11px",
                      color: "#3b82f6",
                      textDecoration: "none",
                      wordBreak: "break-all",
                    }}
                  >
                    {c.citation}
                  </a>
                ) : (
                  <span
                    style={{
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: "11px",
                      color: c.verified ? "#e2e8f0" : "#d97706",
                      wordBreak: "break-word",
                    }}
                  >
                    {c.citation}
                    {!c.verified && (
                      <span
                        style={{
                          marginLeft: "6px",
                          fontSize: "9px",
                          color: "#d97706",
                          letterSpacing: "0.1em",
                        }}
                      >
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
