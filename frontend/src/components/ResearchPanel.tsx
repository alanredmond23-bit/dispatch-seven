// ResearchPanel.tsx — displays structured RESEARCH agent output (Turn 8)
// Shows: confidence badge, summary, expandable finding cards, numbered citations.
// Loading state: 3 skeleton placeholder cards with pulse animation.

import { useState } from "react";

// ── Types (mirrors agents/research.ts) ────────────────────────────────────

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
  confidence: "high" | "medium" | "low";
}

interface ResearchPanelProps {
  result: ResearchResult | null;
  loading: boolean;
}

// ── Design tokens ─────────────────────────────────────────────────────────

const BG      = "#0A0A0F";
const SURFACE = "#111118";
const BORDER  = "#1E1E2E";
const ACCENT  = "#5B6EF5";
const TEXT    = "#E8E8F0";
const TEXT_2  = "#8888AA";
const MONO    = "'JetBrains Mono','Fira Code',monospace";
const SANS    = "'Inter',system-ui,sans-serif";

const CONFIDENCE_COLOR: Record<string, string> = {
  high:   "#22C55E",
  medium: "#F59E0B",
  low:    "#EF4444",
};

const CONFIDENCE_BG: Record<string, string> = {
  high:   "#0D3320",
  medium: "#3D2600",
  low:    "#3D0A0A",
};

// ── Skeleton card ─────────────────────────────────────────────────────────

function SkeletonCard({ index }: { index: number }) {
  return (
    <div
      style={{
        background:   SURFACE,
        border:       `1px solid ${BORDER}`,
        borderRadius: "4px",
        padding:      "14px",
        animationDelay: `${index * 0.15}s`,
      }}
    >
      <style>{`
        @keyframes d7-pulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.8; }
        }
        .d7-skel {
          background: #1E1E2E;
          border-radius: 3px;
          animation: d7-pulse 1.6s ease-in-out infinite;
        }
      `}</style>
      <div className="d7-skel" style={{ height: "10px", width: "40%", marginBottom: "10px" }} />
      <div className="d7-skel" style={{ height: "9px",  width: "90%", marginBottom: "6px"  }} />
      <div className="d7-skel" style={{ height: "9px",  width: "75%", marginBottom: "6px"  }} />
      <div className="d7-skel" style={{ height: "9px",  width: "60%"                       }} />
    </div>
  );
}

// ── Finding card ──────────────────────────────────────────────────────────

function FindingCard({ finding }: { finding: Finding }) {
  const [expanded, setExpanded] = useState(false);

  const truncatedUrl =
    finding.source_url.length > 55
      ? finding.source_url.slice(0, 52) + "…"
      : finding.source_url;

  return (
    <div
      style={{
        background:   SURFACE,
        border:       `1px solid ${BORDER}`,
        borderLeft:   `3px solid ${finding.verified ? "#22C55E" : "#F59E0B"}`,
        borderRadius: "4px",
        marginBottom: "8px",
        overflow:     "hidden",
      }}
    >
      {/* Header row — always visible */}
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          display:    "flex",
          width:      "100%",
          alignItems: "flex-start",
          gap:        "10px",
          padding:    "12px 14px",
          background: "none",
          border:     "none",
          cursor:     "pointer",
          textAlign:  "left",
        }}
      >
        {/* Verified badge */}
        <span
          style={{
            fontFamily:    MONO,
            fontSize:      "8px",
            color:         finding.verified ? "#22C55E" : "#F59E0B",
            letterSpacing: "0.1em",
            minWidth:      "64px",
            paddingTop:    "2px",
          }}
        >
          {finding.verified ? "✓ VERIFIED" : "⚠ UNVERF"}
        </span>

        {/* Claim text */}
        <span
          style={{
            flex:       1,
            fontFamily: SANS,
            fontSize:   "12px",
            color:      TEXT,
            lineHeight: 1.5,
          }}
        >
          {finding.claim}
        </span>

        {/* Expand toggle */}
        <span
          style={{
            fontFamily: MONO,
            fontSize:   "9px",
            color:      TEXT_2,
            paddingTop: "2px",
          }}
        >
          {expanded ? "▴" : "▾"}
        </span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div
          style={{
            padding:    "0 14px 12px 14px",
            borderTop:  `1px solid ${BORDER}`,
          }}
        >
          {/* Evidence */}
          <p
            style={{
              margin:     "10px 0 8px",
              fontFamily: SANS,
              fontSize:   "11px",
              color:      TEXT_2,
              lineHeight: 1.6,
            }}
          >
            {finding.evidence}
          </p>

          {/* Source URL */}
          {finding.source_url && (
            <a
              href={finding.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display:     "block",
                fontFamily:  MONO,
                fontSize:    "9px",
                color:       ACCENT,
                wordBreak:   "break-all",
                textDecoration: "none",
              }}
            >
              {truncatedUrl}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function ResearchPanel({ result, loading }: ResearchPanelProps) {
  const [citationsOpen, setCitationsOpen] = useState(false);

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        style={{
          background:   BG,
          border:       `1px solid ${BORDER}`,
          borderLeft:   `3px solid ${ACCENT}`,
          borderRadius: "4px",
          padding:      "16px",
        }}
      >
        <div
          style={{
            fontFamily:    MONO,
            fontSize:      "10px",
            color:         ACCENT,
            letterSpacing: "0.15em",
            marginBottom:  "16px",
          }}
        >
          RESEARCH — SEARCHING…
        </div>
        <SkeletonCard index={0} />
        <SkeletonCard index={1} />
        <SkeletonCard index={2} />
      </div>
    );
  }

  // ── No result yet ───────────────────────────────────────────────────────
  if (!result) return null;

  const confColor  = CONFIDENCE_COLOR[result.confidence] ?? "#8888AA";
  const confBg     = CONFIDENCE_BG[result.confidence]    ?? "#1E1E2E";

  return (
    <div
      style={{
        background:   BG,
        border:       `1px solid ${BORDER}`,
        borderLeft:   `3px solid ${ACCENT}`,
        borderRadius: "4px",
        padding:      "16px",
        fontFamily:   SANS,
      }}
    >
      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div
        style={{
          display:        "flex",
          justifyContent: "space-between",
          alignItems:     "center",
          marginBottom:   "14px",
        }}
      >
        <span
          style={{
            fontFamily:    MONO,
            fontSize:      "10px",
            color:         ACCENT,
            letterSpacing: "0.15em",
          }}
        >
          RESEARCH RESULTS
        </span>

        {/* Confidence badge */}
        <span
          style={{
            fontFamily:    MONO,
            fontSize:      "9px",
            color:         confColor,
            background:    confBg,
            border:        `1px solid ${confColor}`,
            borderRadius:  "3px",
            padding:       "2px 7px",
            letterSpacing: "0.1em",
          }}
        >
          {result.confidence.toUpperCase()} CONFIDENCE
        </span>
      </div>

      {/* ── Summary ────────────────────────────────────────────────────── */}
      <div
        style={{
          background:   SURFACE,
          border:       `1px solid ${BORDER}`,
          borderRadius: "4px",
          padding:      "12px 14px",
          marginBottom: "16px",
        }}
      >
        <div
          style={{
            fontFamily:    MONO,
            fontSize:      "8px",
            color:         TEXT_2,
            letterSpacing: "0.12em",
            marginBottom:  "8px",
          }}
        >
          SUMMARY
        </div>
        <p
          style={{
            margin:     0,
            fontFamily: SANS,
            fontSize:   "13px",
            color:      TEXT,
            lineHeight: 1.65,
          }}
        >
          {result.summary}
        </p>
      </div>

      {/* ── Findings ───────────────────────────────────────────────────── */}
      {result.findings.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <div
            style={{
              fontFamily:    MONO,
              fontSize:      "8px",
              color:         TEXT_2,
              letterSpacing: "0.12em",
              marginBottom:  "10px",
            }}
          >
            FINDINGS ({result.findings.length})
          </div>
          {result.findings.map((f, i) => (
            <FindingCard key={i} finding={f} />
          ))}
        </div>
      )}

      {/* ── Citations ──────────────────────────────────────────────────── */}
      {result.citations.length > 0 && (
        <div>
          <button
            onClick={() => setCitationsOpen((o) => !o)}
            style={{
              display:        "flex",
              width:          "100%",
              justifyContent: "space-between",
              alignItems:     "center",
              background:     SURFACE,
              border:         `1px solid ${BORDER}`,
              borderRadius:   citationsOpen ? "4px 4px 0 0" : "4px",
              padding:        "9px 14px",
              cursor:         "pointer",
              fontFamily:     MONO,
              fontSize:       "9px",
              color:          TEXT_2,
              letterSpacing:  "0.12em",
            }}
          >
            <span>CITATIONS ({result.citations.length})</span>
            <span>{citationsOpen ? "▴" : "▾"}</span>
          </button>

          {citationsOpen && (
            <div
              style={{
                background:   SURFACE,
                border:       `1px solid ${BORDER}`,
                borderTop:    "none",
                borderRadius: "0 0 4px 4px",
                padding:      "4px 0",
              }}
            >
              {result.citations.map((cit) => (
                <div
                  key={cit.id}
                  style={{
                    display:      "flex",
                    gap:          "12px",
                    padding:      "10px 14px",
                    borderBottom: `1px solid ${BORDER}`,
                  }}
                >
                  {/* Citation number */}
                  <span
                    style={{
                      fontFamily:  MONO,
                      fontSize:    "9px",
                      color:       ACCENT,
                      minWidth:    "18px",
                      paddingTop:  "2px",
                    }}
                  >
                    [{cit.id}]
                  </span>

                  {/* Title + URL + snippet */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily:   SANS,
                        fontSize:     "12px",
                        fontWeight:   600,
                        color:        TEXT,
                        marginBottom: "3px",
                        overflow:     "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace:   "nowrap",
                      }}
                    >
                      {cit.title}
                    </div>
                    <a
                      href={cit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display:        "block",
                        fontFamily:     MONO,
                        fontSize:       "8px",
                        color:          ACCENT,
                        textDecoration: "none",
                        overflow:       "hidden",
                        textOverflow:   "ellipsis",
                        whiteSpace:     "nowrap",
                        marginBottom:   "4px",
                      }}
                    >
                      {cit.url.length > 70 ? cit.url.slice(0, 67) + "…" : cit.url}
                    </a>
                    <p
                      style={{
                        margin:     0,
                        fontFamily: SANS,
                        fontSize:   "11px",
                        color:      TEXT_2,
                        lineHeight: 1.5,
                      }}
                    >
                      {cit.snippet.length > 140 ? cit.snippet.slice(0, 137) + "…" : cit.snippet}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
