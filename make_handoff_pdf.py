#!/usr/bin/env python3
"""Generate Fleet Dispatcher handoff PDF."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether, Preformatted
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

OUT = "/Users/stripe_secure/Desktop/fleet-dispatcher/FLEET_DISPATCHER_HANDOFF.pdf"

# ── Palette ──────────────────────────────────────────────────────────────────
BLACK     = colors.HexColor("#0A0A0A")
DARK      = colors.HexColor("#1A1A2E")
ACCENT    = colors.HexColor("#E94560")
BLUE      = colors.HexColor("#0F3460")
GREY_DARK = colors.HexColor("#2D2D2D")
GREY_MID  = colors.HexColor("#666666")
GREY_LITE = colors.HexColor("#F5F5F5")
WHITE     = colors.white
GREEN     = colors.HexColor("#27AE60")
AMBER     = colors.HexColor("#F39C12")
RED_SOFT  = colors.HexColor("#C0392B")
TEAL      = colors.HexColor("#16A085")

# ── Styles ───────────────────────────────────────────────────────────────────
SS = getSampleStyleSheet()

def style(name, **kw):
    s = SS["Normal"].clone(name)
    for k, v in kw.items():
        setattr(s, k, v)
    return s

COVER_TITLE   = style("CoverTitle",  fontSize=28, textColor=WHITE,   fontName="Helvetica-Bold", leading=34, alignment=TA_LEFT)
COVER_SUB     = style("CoverSub",    fontSize=13, textColor=colors.HexColor("#AAAAAA"), fontName="Helvetica", leading=18, alignment=TA_LEFT)
COVER_META    = style("CoverMeta",   fontSize=10, textColor=colors.HexColor("#888888"), fontName="Helvetica", leading=14, alignment=TA_LEFT)
SEC_HEAD      = style("SecHead",     fontSize=14, textColor=ACCENT,   fontName="Helvetica-Bold", leading=18, spaceBefore=18, spaceAfter=6)
BODY          = style("Body",        fontSize=10, textColor=GREY_DARK, fontName="Helvetica", leading=15, spaceAfter=6)
BOLD_BODY     = style("BoldBody",    fontSize=10, textColor=BLACK,    fontName="Helvetica-Bold", leading=15, spaceAfter=4)
BULLET        = style("Bullet",      fontSize=10, textColor=GREY_DARK, fontName="Helvetica", leading=14, leftIndent=16, spaceAfter=3)
CODE_STYLE    = style("Code",        fontSize=8.5, textColor=colors.HexColor("#2ECC71"), fontName="Courier", leading=13, leftIndent=12, backColor=colors.HexColor("#111111"))
CAPTION       = style("Caption",     fontSize=8,  textColor=GREY_MID,  fontName="Helvetica-Oblique", leading=11, alignment=TA_CENTER)
LABEL_LIVE    = style("LabelLive",   fontSize=8,  textColor=WHITE,     fontName="Helvetica-Bold", leading=10, alignment=TA_CENTER)
FOOTER_STYLE  = style("Footer",      fontSize=8,  textColor=GREY_MID,  fontName="Helvetica", leading=10, alignment=TA_CENTER)

def hr(color=ACCENT, thickness=0.75):
    return HRFlowable(width="100%", thickness=thickness, color=color, spaceAfter=8, spaceBefore=4)

def spacer(h=0.15):
    return Spacer(1, h * inch)

def sec(text):
    return Paragraph(text, SEC_HEAD)

def body(text):
    return Paragraph(text, BODY)

def bold(text):
    return Paragraph(text, BOLD_BODY)

def bullet(text):
    return Paragraph(f"&nbsp;&nbsp;•&nbsp;&nbsp;{text}", BULLET)

def code(text):
    return Preformatted(text, CODE_STYLE)

# ── Table helpers ─────────────────────────────────────────────────────────────
TBL_HEAD_STYLE = [
    ("BACKGROUND",  (0,0), (-1,0), DARK),
    ("TEXTCOLOR",   (0,0), (-1,0), WHITE),
    ("FONTNAME",    (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE",    (0,0), (-1,0), 9),
    ("BOTTOMPADDING",(0,0),(-1,0), 7),
    ("TOPPADDING",  (0,0), (-1,0), 7),
    ("GRID",        (0,0), (-1,-1), 0.4, colors.HexColor("#DDDDDD")),
    ("FONTNAME",    (0,1), (-1,-1), "Helvetica"),
    ("FONTSIZE",    (0,1), (-1,-1), 9),
    ("ROWBACKGROUNDS",(0,1),(-1,-1),[WHITE, GREY_LITE]),
    ("VALIGN",      (0,0), (-1,-1), "MIDDLE"),
    ("TOPPADDING",  (0,1), (-1,-1), 5),
    ("BOTTOMPADDING",(0,1),(-1,-1), 5),
    ("LEFTPADDING", (0,0), (-1,-1), 8),
    ("RIGHTPADDING",(0,0), (-1,-1), 8),
]

def status_cell(text, color):
    return Paragraph(f'<font color="{color.hexval()}" name="Helvetica-Bold">■</font> {text}', BODY)

# ── Build ─────────────────────────────────────────────────────────────────────
def build():
    doc = SimpleDocTemplate(
        OUT,
        pagesize=letter,
        leftMargin=0.75*inch,
        rightMargin=0.75*inch,
        topMargin=0.6*inch,
        bottomMargin=0.7*inch,
    )

    story = []

    # ── COVER BLOCK ──────────────────────────────────────────────────────────
    cover_data = [[
        Paragraph("FLEET DISPATCHER", COVER_TITLE),
    ]]
    cover_tbl = Table(cover_data, colWidths=[7*inch])
    cover_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), DARK),
        ("TOPPADDING",  (0,0), (-1,-1), 28),
        ("BOTTOMPADDING",(0,0),(-1,-1), 10),
        ("LEFTPADDING", (0,0), (-1,-1), 20),
        ("RIGHTPADDING",(0,0), (-1,-1), 20),
    ]))
    story.append(cover_tbl)

    sub_data = [[
        Paragraph("Handoff Document &amp; Agent Team Playbook", COVER_SUB),
    ]]
    sub_tbl = Table(sub_data, colWidths=[7*inch])
    sub_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), DARK),
        ("TOPPADDING",  (0,0), (-1,-1), 4),
        ("BOTTOMPADDING",(0,0),(-1,-1), 8),
        ("LEFTPADDING", (0,0), (-1,-1), 20),
        ("RIGHTPADDING",(0,0), (-1,-1), 20),
    ]))
    story.append(sub_tbl)

    meta_data = [[
        Paragraph("WORKHORSE — stripe_secure &nbsp;&nbsp;|&nbsp;&nbsp; Generated: 2026-06-26 &nbsp;&nbsp;|&nbsp;&nbsp; Version: 1.0", COVER_META),
    ]]
    meta_tbl = Table(meta_data, colWidths=[7*inch])
    meta_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), colors.HexColor("#111122")),
        ("TOPPADDING",  (0,0), (-1,-1), 8),
        ("BOTTOMPADDING",(0,0),(-1,-1), 12),
        ("LEFTPADDING", (0,0), (-1,-1), 20),
        ("RIGHTPADDING",(0,0), (-1,-1), 20),
    ]))
    story.append(meta_tbl)
    story.append(spacer(0.25))

    # ── SECTION 1: WHAT WAS BUILT ────────────────────────────────────────────
    story.append(sec("1. WHAT WAS BUILT"))
    story.append(hr())
    story.append(body(
        "Fleet Dispatcher is a custom session dispatch and persistence layer built to replace "
        "Claude.ai Dispatch for all fleet operations. It lives at <b>~/Desktop/fleet-dispatcher/</b> "
        "and runs locally at <b>http://127.0.0.1:8424</b>."
    ))
    story.append(spacer(0.1))
    story.append(bold("Core improvements over Claude.ai Dispatch:"))

    improvements = [
        ("SQLite session persistence", "Sessions survive restarts — full history always available"),
        ("Two-panel UI", "Live job stream on the right, full session history sidebar on the left"),
        ("Session search", "Cmd+K search across all historical sessions by prompt or target"),
        ("Export", "Any session exported as .md or .json in one click"),
        ("Live SSE streaming", "Real-time job output — no polling, no page refresh"),
        ("Status tracking", "Running / Done / Error with color-coded indicators"),
        ("Token counts", "Per-session token tracking (in + out) persisted to DB"),
        ("No stuck-session bug", "Eliminated the post-compact re-emit bug that kills Claude.ai Dispatch"),
        ("Multi-target dispatch", "Submit to WORKHORSE, ADMIN, QUICKS, Cloud, or Self-hosted"),
        ("Thread-safe DB", "DB_LOCK on all SQLite writes — safe for concurrent jobs"),
    ]

    imp_tbl = Table(
        [["CAPABILITY", "DETAIL"]] + [[bold(a), body(b)] for a, b in improvements],
        colWidths=[2.2*inch, 4.8*inch]
    )
    imp_tbl.setStyle(TableStyle(TBL_HEAD_STYLE))
    story.append(imp_tbl)
    story.append(spacer(0.2))

    # ── SECTION 2: CURRENT STATE ─────────────────────────────────────────────
    story.append(sec("2. CURRENT STATE"))
    story.append(hr())

    def s_live(label):  return [body(label), status_cell("LIVE", GREEN)]
    def s_prov(label):  return [body(label), status_cell("PROVISIONED", TEAL)]
    def s_block(label): return [body(label), status_cell("BLOCKED", AMBER)]

    state_rows = [
        ["COMPONENT", "STATUS"],
        *[s_live(x) for x in [
            "Fleet Dispatcher UI — http://127.0.0.1:8424",
            "SQLite session DB — sessions.db",
            "WORKHORSE target (local bash)",
            "ADMIN target (SSH via Tailscale 100.124.123.68)",
            "QUICKS target (SSH via quicks.local)",
        ]],
        *[s_prov(x) for x in [
            "Cloud Environment — env_01FmFrfEj4ERMQAKnYLKKdhc",
            "Self-hosted Environment — env_01NqFV2TZd5X82JEijALpfJ9",
        ]],
        *[s_block(x) for x in [
            "Cloud Agent — needs API credits + setup.py",
            "Self-hosted Agent — needs API credits + setup.py + env key",
        ]],
    ]

    state_tbl = Table(state_rows, colWidths=[5.2*inch, 1.8*inch])
    state_tbl.setStyle(TableStyle(TBL_HEAD_STYLE + [
        ("ALIGN", (1,0), (1,-1), "CENTER"),
    ]))
    story.append(state_tbl)
    story.append(spacer(0.2))

    # ── SECTION 3: CAN WE RUN AGENT TEAMS YET ───────────────────────────────
    story.append(sec("3. DISPATCH AGENT TEAMS — CAN WE DO THIS YET?"))
    story.append(hr())
    story.append(body(
        "<b>Short answer:</b> Tier 1 works now. Tier 2 (managed cloud agents) is one top-up away."
    ))
    story.append(spacer(0.1))

    tier_rows = [
        ["TIER", "CAPABILITY", "STATUS", "WHAT'S NEEDED"],
        [
            bold("Tier 1\nDirect Fleet"),
            body("Dispatch jobs to WORKHORSE, ADMIN, QUICKS simultaneously.\nAll run in parallel threads with live streaming.\nFull persistence and history."),
            status_cell("WORKS NOW", GREEN),
            body("Nothing — already live.")
        ],
        [
            bold("Tier 2\nCloud Agents"),
            body("Anthropic-hosted agents with tool access (bash, GitHub, files).\nPersistent long-running tasks.\nAgent calls back to WORKHORSE via FLEET_EXEC_TOOL."),
            status_cell("BLOCKED", AMBER),
            body("1. Add API credits\n2. Re-run setup.py\n3. Paste agent IDs to .env")
        ],
        [
            bold("Tier 2\nSelf-hosted"),
            body("Agent runs on WORKHORSE directly.\nFull local tool access without cloud round-trip.\nBest for sensitive or large-file tasks."),
            status_cell("BLOCKED", AMBER),
            body("Same as above + generate\nANTHROPIC_ENVIRONMENT_KEY\nfrom Anthropic Console")
        ],
    ]

    tier_tbl = Table(tier_rows, colWidths=[1.0*inch, 2.6*inch, 1.1*inch, 2.3*inch])
    tier_tbl.setStyle(TableStyle(TBL_HEAD_STYLE + [
        ("VALIGN", (0,0), (-1,-1), "TOP"),
    ]))
    story.append(tier_tbl)
    story.append(spacer(0.2))

    # ── SECTION 4: HOW AGENT TEAMS WORK ─────────────────────────────────────
    story.append(sec("4. HOW TO RUN DISPATCH AGENT TEAMS"))
    story.append(hr())

    story.append(bold("Tier 1 — Right Now (Direct Fleet Dispatch)"))
    story.append(body(
        "To run a parallel team across all fleet machines:"
    ))
    steps_t1 = [
        "Open Fleet Dispatcher: http://127.0.0.1:8424",
        "Select target: WORKHORSE → type prompt → click Run",
        "Select target: ADMIN → same prompt → click Run",
        "Select target: QUICKS → same prompt → click Run",
        "All three run simultaneously in parallel threads",
        "Watch live output in each job card — results stream via SSE",
        "Click any finished session in the left sidebar to review transcript",
        "Export any session as .md for reporting",
    ]
    for s in steps_t1:
        story.append(bullet(s))

    story.append(spacer(0.15))
    story.append(bold("Tier 2 — Cloud Agent Architecture (once credits added)"))
    story.append(body("The full pipeline once Anthropic managed agents are provisioned:"))
    story.append(code(
"Fleet Dispatcher UI\n"
"       ↓  (HTTP POST /run)\n"
"  ui.py job handler\n"
"       ↓  (beta.agents.sessions.create)\n"
"  Anthropic Cloud Agent   ←→   GitHub Vault (MCP tools)\n"
"       ↓  (tool_use: fleet_exec)\n"
"  FLEET_EXEC_TOOL callback → WORKHORSE bash executor\n"
"       ↓  (spawns sub-jobs)\n"
"  ADMIN / QUICKS via SSH"
    ))
    story.append(spacer(0.1))
    story.append(body(
        "The cloud agent receives your prompt plus access to the GitHub vault and "
        "FLEET_EXEC_TOOL (a custom tool that lets it run commands on WORKHORSE). "
        "It can autonomously plan multi-step tasks, call tools, and report results "
        "back to the dispatcher UI in real time."
    ))

    story.append(spacer(0.15))
    story.append(bold("Tier 2 — Self-hosted Agent (once environment key generated)"))
    story.append(body(
        "The self-hosted agent runs the model on WORKHORSE itself. Best for tasks "
        "involving large local files, sensitive data, or operations that must not "
        "leave the machine. Connect via the Anthropic Console → Environments → "
        "fleet-dispatcher-selfhosted → Generate Key → paste to ANTHROPIC_ENVIRONMENT_KEY."
    ))
    story.append(spacer(0.2))

    # ── SECTION 5: UNLOCK TIER 2 CHECKLIST ──────────────────────────────────
    story.append(sec("5. ONE-TIME UNLOCK — TIER 2 CHECKLIST"))
    story.append(hr())

    unlock_rows = [
        ["#", "ACTION", "WHERE", "STATUS"],
        ["1", body("Add API credits to account"), body("platform.anthropic.com\n→ Plans & Billing"), status_cell("PENDING", AMBER)],
        ["2", body("Re-run setup.py"), code("cd ~/Desktop/fleet-dispatcher\nsource ~/MASTER_RULES/SECRETS.env\npython3 setup.py"), status_cell("PENDING", AMBER)],
        ["3", body("Paste agent IDs to .env\n(auto-saved to fleet.ids.json)"), body("setup.py prints:\nAGENT_CLOUD_ID=...\nAGENT_SELFHOSTED_ID=..."), status_cell("PENDING", AMBER)],
        ["4", body("Generate self-hosted env key"), body("Anthropic Console\n→ Environments\n→ fleet-dispatcher-selfhosted\n→ Generate Key"), status_cell("PENDING", AMBER)],
        ["5", body("Add ANTHROPIC_ENVIRONMENT_KEY to .env"), body("~/Desktop/fleet-dispatcher/.env"), status_cell("PENDING", AMBER)],
        ["6", body("Restart Fleet Dispatcher"), code("python3 ui.py"), status_cell("PENDING", AMBER)],
    ]

    unlock_tbl = Table(unlock_rows, colWidths=[0.3*inch, 1.8*inch, 2.8*inch, 1.1*inch])
    unlock_tbl.setStyle(TableStyle(TBL_HEAD_STYLE + [
        ("ALIGN", (0,0), (0,-1), "CENTER"),
        ("FONTNAME", (0,1), (0,-1), "Helvetica-Bold"),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
    ]))
    story.append(unlock_tbl)
    story.append(spacer(0.2))

    # ── SECTION 6: KEY FILES ─────────────────────────────────────────────────
    story.append(sec("6. KEY FILES"))
    story.append(hr())

    file_rows = [
        ["FILE", "PURPOSE"],
        [body("~/Desktop/fleet-dispatcher/ui.py"),        body("Main app — HTTP server, SSE streaming, SQLite layer, all endpoints")],
        [body("~/Desktop/fleet-dispatcher/common.py"),     body("Fleet config: hosts, model (claude-fable-5), FLEET_EXEC_TOOL definition")],
        [body("~/Desktop/fleet-dispatcher/setup.py"),      body("One-time Anthropic platform provisioning — re-run after credits")],
        [body("~/Desktop/fleet-dispatcher/.env"),          body("API keys + env/agent IDs — CLOUD_ENV_ID and SELFHOSTED_ENV_ID already set")],
        [body("~/Desktop/fleet-dispatcher/sessions.db"),   body("SQLite session history — survives restarts, full transcript storage")],
        [body("~/Desktop/fleet-dispatcher/fleet.ids.json"),body("Auto-generated by setup.py — agent + env IDs after provisioning")],
        [body("~/Desktop/DEVOPS/DISPATCH:COWORK/fleet-dispatcher/"), body("Synced mirror copy — kept in sync with Desktop version")],
        [body("~/MASTER_RULES/RULES.md"),                  body("Protected directory rules — guard against fleet-reorg scripts")],
    ]

    file_tbl = Table(file_rows, colWidths=[3.5*inch, 3.5*inch])
    file_tbl.setStyle(TableStyle(TBL_HEAD_STYLE))
    story.append(file_tbl)
    story.append(spacer(0.2))

    # ── SECTION 7: QUICK START ───────────────────────────────────────────────
    story.append(sec("7. QUICK START COMMANDS"))
    story.append(hr())

    story.append(bold("Start Fleet Dispatcher:"))
    story.append(code("cd ~/Desktop/fleet-dispatcher && source ~/MASTER_RULES/SECRETS.env && python3 ui.py"))
    story.append(spacer(0.08))

    story.append(bold("Open UI:"))
    story.append(code("open http://127.0.0.1:8424"))
    story.append(spacer(0.08))

    story.append(bold("Check active sessions in DB:"))
    story.append(code("sqlite3 ~/Desktop/fleet-dispatcher/sessions.db 'SELECT id,target,status,title FROM sessions ORDER BY created_at DESC LIMIT 10;'"))
    story.append(spacer(0.08))

    story.append(bold("Re-run provisioning after credit top-up:"))
    story.append(code("cd ~/Desktop/fleet-dispatcher && source ~/MASTER_RULES/SECRETS.env && python3 setup.py"))
    story.append(spacer(0.08))

    story.append(bold("Remote access from home (SSH via Tailscale):"))
    story.append(code("ssh stripe_secure@100.85.49.118\n# then in tmux:\ntmux attach -t dispatch\n# or start new:\ncd ~/Desktop/fleet-dispatcher && source ~/MASTER_RULES/SECRETS.env && python3 ui.py"))
    story.append(spacer(0.08))

    story.append(bold("Port-forward UI to home machine:"))
    story.append(code("ssh -L 8424:127.0.0.1:8424 stripe_secure@100.85.49.118\n# then open http://127.0.0.1:8424 on home machine"))
    story.append(spacer(0.2))

    # ── SECTION 8: PROTECTED DIRECTORIES ────────────────────────────────────
    story.append(sec("8. PROTECTED DIRECTORIES — NEVER TOUCH"))
    story.append(hr())
    story.append(body(
        "The Jun 11, 2026 incident: a fleet-reorg script silently moved the entire dispatch "
        "workspace to .fleet-migrated-trash with no audit trail. Files recovered Jun 26, 2026. "
        "The following directories are now sentinel-protected (.no-delete files) and documented in RULES.md:"
    ))
    story.append(spacer(0.08))

    prot_dirs = [
        "~/Desktop/fleet-dispatcher/",
        "~/Desktop/DEVOPS/DISPATCH:COWORK/",
        "~/.cortex/",
        "~/MASTER_RULES/",
        "~/.claude/",
        "~/claude-memories/",
        "~/Desktop/Perfect Claude System/",
        "03_LEGAL_P1/ (anywhere) — RED zone",
    ]
    for d in prot_dirs:
        story.append(bullet(d))

    story.append(spacer(0.1))
    story.append(body(
        "Any script that moves or deletes files MUST: print targets before acting, "
        "require CONFIRM=yes, never touch protected dirs, write a recovery manifest to "
        "~/MASTER_RULES/logs/ before acting."
    ))
    story.append(spacer(0.2))

    # ── SECTION 9: KNOWN BUGS / CLAUDE.AI DISPATCH ──────────────────────────
    story.append(sec("9. WHY CLAUDE.AI DISPATCH GOES SILENT"))
    story.append(hr())
    story.append(body(
        "Root cause confirmed via ~/Library/Logs/Claude/main.log (line ~122,736):"
    ))
    story.append(code(
        "[sessions-bridge] Dropping user echo with empty inboundUserMessages FIFO\n"
        "for session cse_014dVm93b6Fpf8NEPu6jHRFD (likely post-compact re-emit)"
    ))
    story.append(body(
        "After context compaction, the sessions bridge seeds processedMessageUuids on reconnect. "
        "New user messages are then incorrectly flagged as already-processed echoes and silently "
        "dropped. The session appears online but never receives new input. "
        "Fix: start a new task. Anthropic must fix this on their end — it is a Dispatch beta bug."
    ))
    story.append(body(
        "Fleet Dispatcher avoids this entirely — each job is a stateless HTTP request with "
        "its own thread. No session state to corrupt, no re-emit bug possible."
    ))

    story.append(spacer(0.3))
    story.append(hr(color=GREY_MID, thickness=0.4))
    story.append(Paragraph(
        "FLEET DISPATCHER HANDOFF v1.0 &nbsp;|&nbsp; WORKHORSE &nbsp;|&nbsp; 2026-06-26 &nbsp;|&nbsp; stripe_secure",
        FOOTER_STYLE
    ))

    doc.build(story)
    print(f"PDF written → {OUT}")

if __name__ == "__main__":
    build()
