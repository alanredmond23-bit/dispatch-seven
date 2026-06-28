"""Fleet Dispatcher UI — beats Claude Dispatch in every dimension.

Advantages:
  - Persistent session history (SQLite) — survives restarts, searchable
  - Full transcript replay per session
  - Export to Markdown or JSON
  - Token + duration tracking
  - Fleet SSH control (WORKHORSE / ADMIN / QUICKS)
  - Thinking/reasoning blocks displayed collapsibly
  - Tool call detail with collapsible JSON
  - Cron job management (SQLite-backed)
  - Health dashboard per machine (disk/mem/load)
  - Mobile responsive with bottom-sheet sidebar
  - No post-compact re-emit bug
  - Programmatic: scriptable via HTTP POST, cron-able, webhook-able
  - Parallel jobs with live SSE streams
  - One-click Provision

Run:  python3 ui.py   ->  http://127.0.0.1:8424
Stdlib only — no framework dependencies beyond anthropic SDK.
"""
from __future__ import annotations

import json
import os
import queue
import sqlite3
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8424
DB_PATH = os.path.join(ROOT, "sessions.db")
DB_LOCK = threading.Lock()

# ---------------------------------------------------------------------------
# config
# ---------------------------------------------------------------------------

FLEET_HOSTS = {"WORKHORSE": None, "ADMIN": "admin.local", "QUICKS": "quicks.local"}


def load_env() -> dict:
    cfg = dict(os.environ)
    for fname in (".env",):
        path = os.path.join(ROOT, fname)
        if os.path.exists(path):
            for line in open(path):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    cfg.setdefault(k.strip(), v.strip())
    ids_path = os.path.join(ROOT, "fleet.ids.json")
    if os.path.exists(ids_path):
        for k, v in json.load(open(ids_path)).items():
            if v:
                cfg.setdefault(k, v)
    return cfg

# ---------------------------------------------------------------------------
# SQLite session store
# ---------------------------------------------------------------------------


def init_db() -> None:
    with DB_LOCK, sqlite3.connect(DB_PATH) as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id           TEXT PRIMARY KEY,
            target       TEXT NOT NULL,
            prompt       TEXT NOT NULL DEFAULT '',
            title        TEXT NOT NULL DEFAULT '',
            status       TEXT NOT NULL DEFAULT 'running',
            created_at   REAL NOT NULL,
            updated_at   REAL NOT NULL,
            finished_at  REAL,
            anthropic_id TEXT,
            tokens_in    INTEGER NOT NULL DEFAULT 0,
            tokens_out   INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS messages (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            kind       TEXT NOT NULL,
            text       TEXT NOT NULL,
            ts         REAL NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS cron_jobs (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            schedule    TEXT NOT NULL,
            target      TEXT NOT NULL,
            command     TEXT NOT NULL,
            enabled     INTEGER NOT NULL DEFAULT 1,
            last_run    REAL,
            last_status TEXT,
            created_at  REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_msg_sid      ON messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_sess_created ON sessions(created_at DESC);
        """)
        # Migrate older cron_jobs schemas — add columns if absent (SQLite ignores existing)
        for _col, _def in [
            ("next_run",   "REAL"),
            ("run_count",  "INTEGER NOT NULL DEFAULT 0"),
        ]:
            try:
                con.execute(f"ALTER TABLE cron_jobs ADD COLUMN {_col} {_def}")
            except Exception:
                pass  # column already exists
        # Create next_run index idempotently
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_cron_next ON cron_jobs(next_run)")
        # Seed 5 default jobs on first boot (empty table only)
        if con.execute("SELECT COUNT(*) FROM cron_jobs").fetchone()[0] == 0:
            _seed_default_cron_jobs(con)


def _seed_default_cron_jobs(con) -> None:
    """Insert the 5 default cron jobs. Called only when cron_jobs is empty."""
    now = time.time()
    defaults = [
        ("Daily AI Brief + Fleet Health", "0 6 * * *", "cloud",
         "Run the ai-daily-debrief skill for today's LLM/AI news. "
         "Then check disk, memory, and uptime on WORKHORSE, ADMIN, QUICKS."),
        ("Fleet Resource Monitor — Alert >85%", "*/30 * * * *", "fleet:WORKHORSE",
         "df -h / | tail -1; free -m 2>/dev/null | awk 'NR==2{print \"MEM:\", $3\"/\"$2 \"MB\"}'; "
         "uptime; echo '--- WORKHORSE ok ---'"),
        ("Daily Legal Docket Pull", "0 7 * * *", "cloud",
         "Use docket-pull and legal:deadline-calendar skills. "
         "Pull dockets for 5:24-cr-00376, 4:24-bk-13093, AP 25-00254, AP 25-00119. "
         "Summarize new filings from last 24h. Flag deadlines within 14 days in RED."),
        ("Weekly Project Status — All 72 Swim Lanes", "0 8 * * 1", "cloud",
         "Use project-memory skill. Weekly status across all 72 active swim lanes. "
         "Current status, blockers, shipped this week, due next week. "
         "Highlight RED items. Save dated Markdown to fleet-dispatcher folder."),
        ("Nightly Secrets Audit — WORKHORSE Desktop", "0 23 * * *", "fleet:WORKHORSE",
         "grep -rn --include='*.env' --include='*.json' --include='*.yaml' --include='*.sh' "
         "-E '(password|secret|api_key|token|private_key)\\s*[=:]\\s*[^$<{]' "
         "~/Desktop ~/Documents ~/.config 2>/dev/null | grep -v '.venv' | grep -v 'node_modules' "
         "| head -60; echo '--- secrets audit complete ---'"),
    ]
    for name, schedule, target, command in defaults:
        nxt = compute_next_run(schedule, now)
        con.execute(
            "INSERT INTO cron_jobs(id,name,schedule,target,command,enabled,next_run,run_count,created_at) "
            "VALUES(?,?,?,?,?,1,?,0,?)",
            (uuid.uuid4().hex[:12], name, schedule, target, command, nxt, now),
        )


def db_create_session(job_id: str, target: str, prompt: str, title: str) -> None:
    now = time.time()
    with DB_LOCK, sqlite3.connect(DB_PATH) as con:
        con.execute(
            "INSERT INTO sessions(id,target,prompt,title,status,created_at,updated_at) "
            "VALUES(?,?,?,?,'running',?,?)",
            (job_id, target, prompt, title, now, now),
        )


def db_append_message(session_id: str, kind: str, text: str) -> None:
    with DB_LOCK, sqlite3.connect(DB_PATH) as con:
        con.execute(
            "INSERT INTO messages(session_id,kind,text,ts) VALUES(?,?,?,?)",
            (session_id, kind, text, time.time()),
        )
        con.execute("UPDATE sessions SET updated_at=? WHERE id=?",
                    (time.time(), session_id))


def db_finish_session(session_id: str, status: str,
                      anthropic_id: str | None = None,
                      tokens_in: int = 0, tokens_out: int = 0) -> None:
    now = time.time()
    with DB_LOCK, sqlite3.connect(DB_PATH) as con:
        con.execute(
            "UPDATE sessions SET status=?,finished_at=?,updated_at=?,"
            "anthropic_id=COALESCE(?,anthropic_id),"
            "tokens_in=tokens_in+?,tokens_out=tokens_out+? WHERE id=?",
            (status, now, now, anthropic_id, tokens_in, tokens_out, session_id),
        )


def db_list_sessions(search: str = "", limit: int = 200) -> list[dict]:
    q = ("SELECT id,target,title,prompt,status,created_at,finished_at,"
         "tokens_in,tokens_out FROM sessions")
    args: list = []
    if search:
        q += " WHERE prompt LIKE ? OR title LIKE ?"
        args = [f"%{search}%", f"%{search}%"]
    q += " ORDER BY created_at DESC LIMIT ?"
    args.append(limit)
    with DB_LOCK, sqlite3.connect(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute(q, args).fetchall()
    return [dict(r) for r in rows]


def db_get_session(session_id: str) -> dict | None:
    with DB_LOCK, sqlite3.connect(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        row = con.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
        if not row:
            return None
        msgs = con.execute(
            "SELECT kind,text,ts FROM messages WHERE session_id=? ORDER BY id",
            (session_id,),
        ).fetchall()
    return {**dict(row), "messages": [dict(m) for m in msgs]}


def db_delete_session(session_id: str) -> bool:
    with DB_LOCK, sqlite3.connect(DB_PATH) as con:
        cur = con.execute("DELETE FROM sessions WHERE id=?", (session_id,))
        con.execute("DELETE FROM messages WHERE session_id=?", (session_id,))
    return cur.rowcount > 0


def session_to_markdown(s: dict) -> str:
    lines = [
        f"# Session: {s['title'] or s['id']}",
        f"**Target:** {s['target']}  **Status:** {s['status']}",
        f"**Created:** {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(s['created_at']))}",
    ]
    if s.get("finished_at"):
        dur = s["finished_at"] - s["created_at"]
        lines.append(
            f"**Duration:** {dur:.0f}s  "
            f"**Tokens:** {s['tokens_in']} in / {s['tokens_out']} out"
        )
    if s.get("anthropic_id"):
        lines.append(f"**Anthropic session:** `{s['anthropic_id']}`")
    lines += ["", f"**Prompt:** {s['prompt']}", "", "---", ""]
    for m in s.get("messages", []):
        ts = time.strftime("%H:%M:%S", time.localtime(m["ts"]))
        prefix = {
            "out":          "**Claude:**",
            "tool":         "**Tool:**",
            "fleet":        "**Fleet:**",
            "fleet_result": "**Fleet Result:**",
            "thinking":     "*Thinking:*",
            "err":          "**Error:**",
            "info":         "*Info:*",
        }.get(m["kind"], f"[{m['kind']}]")
        lines.append(f"`{ts}` {prefix} {m['text']}")
    return "\n".join(lines)

# ---------------------------------------------------------------------------
# cron job management
# ---------------------------------------------------------------------------


def db_list_cron() -> list[dict]:
    with DB_LOCK, sqlite3.connect(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute("SELECT * FROM cron_jobs ORDER BY created_at").fetchall()
    return [dict(r) for r in rows]


def db_create_cron(name: str, schedule: str, target: str, command: str) -> str:
    cid = uuid.uuid4().hex[:12]
    now = time.time()
    nxt = compute_next_run(schedule, now)
    with DB_LOCK, sqlite3.connect(DB_PATH) as con:
        con.execute(
            "INSERT INTO cron_jobs(id,name,schedule,target,command,enabled,next_run,run_count,created_at) "
            "VALUES(?,?,?,?,?,1,?,0,?)",
            (cid, name, schedule, target, command, nxt, now),
        )
    return cid


def db_update_cron(cid: str, **kwargs) -> bool:
    if not kwargs:
        return False
    sets = ", ".join(f"{k}=?" for k in kwargs)
    vals = list(kwargs.values()) + [cid]
    with DB_LOCK, sqlite3.connect(DB_PATH) as con:
        cur = con.execute(f"UPDATE cron_jobs SET {sets} WHERE id=?", vals)
    return cur.rowcount > 0


def db_delete_cron(cid: str) -> bool:
    with DB_LOCK, sqlite3.connect(DB_PATH) as con:
        cur = con.execute("DELETE FROM cron_jobs WHERE id=?", (cid,))
    return cur.rowcount > 0


def db_advance_cron(cid: str, fired_at: float, next_run: float | None) -> None:
    """Update last_run, next_run, and increment run_count after a cron fires."""
    with DB_LOCK, sqlite3.connect(DB_PATH) as con:
        con.execute(
            "UPDATE cron_jobs SET last_run=?, last_status='running', "
            "next_run=?, run_count=run_count+1 WHERE id=?",
            (fired_at, next_run, cid),
        )

# ---------------------------------------------------------------------------
# cron expression engine — 5-field: min hour day month weekday
# ---------------------------------------------------------------------------


def _cron_field_matches(expr: str, val: int) -> bool:
    """Match one cron field against an integer value.
    Supports: * | n | */step | n-m | n,m (composable with commas)."""
    if expr == "*":
        return True
    if expr.startswith("*/"):
        step = int(expr[2:])
        return step > 0 and val % step == 0
    for part in expr.split(","):
        part = part.strip()
        if "-" in part:
            lo, hi = part.split("-", 1)
            if int(lo) <= val <= int(hi):
                return True
        elif int(part) == val:
            return True
    return False


def _cron_matches(expr: str, t: time.struct_time) -> bool:
    """Return True if the 5-field cron expression fires at struct_time t."""
    parts = expr.split()
    if len(parts) != 5:
        return False
    # Python tm_wday 0=Mon…6=Sun → cron weekday 0=Sun…6=Sat
    cron_wday = (t.tm_wday + 1) % 7
    return all(_cron_field_matches(f, v) for f, v in zip(parts, [
        t.tm_min, t.tm_hour, t.tm_mday, t.tm_mon, cron_wday,
    ]))


def compute_next_run(schedule: str, after_ts: float) -> float | None:
    """Scan minute-by-minute (up to 366 days) for the next firing epoch.
    Returns None only on a parse error or genuinely unmatchable expression."""
    try:
        cursor = int(after_ts) - (int(after_ts) % 60) + 60  # start of next minute
        limit  = cursor + 366 * 24 * 3600
        while cursor <= limit:
            if _cron_matches(schedule, time.localtime(cursor)):
                return float(cursor)
            cursor += 60
        return None
    except Exception:
        return None

# ---------------------------------------------------------------------------
# CronScheduler — background daemon; polls every 30 s; fires due enabled jobs
# ---------------------------------------------------------------------------


class CronScheduler:
    POLL_INTERVAL = 30  # seconds

    def __init__(self) -> None:
        self._stop = threading.Event()

    def start(self) -> None:
        self._stop.clear()
        threading.Thread(target=self._loop, name="CronScheduler", daemon=True).start()
        print(f"[cron] scheduler started (poll every {self.POLL_INTERVAL}s)")

    def _loop(self) -> None:
        self._stop.wait(5)  # let HTTP server settle before first tick
        while not self._stop.is_set():
            try:
                self._tick()
            except Exception as exc:
                print(f"[cron] tick error: {exc}")
            self._stop.wait(self.POLL_INTERVAL)

    def _tick(self) -> None:
        now = time.time()
        for job in db_list_cron():
            if not job.get("enabled"):
                continue
            nxt = job.get("next_run")
            if nxt is None:
                # Recover missing next_run (e.g. jobs created before this upgrade)
                nxt = compute_next_run(job["schedule"], now)
                if nxt:
                    db_advance_cron(job["id"], job.get("last_run") or 0.0, nxt)
                continue
            if now >= nxt:
                self._fire(job, now)

    def _fire(self, job: dict, fired_at: float) -> None:
        """Dispatch job as a live session and advance its schedule."""
        target  = job["target"]
        command = job["command"]
        cron_prompt = f"[CRON: {job['name']}]\n{command}"

        job_id = new_job(target, cron_prompt)
        emit(job_id, "info",
             f"[cron] '{job['name']}' fired at "
             f"{time.strftime('%Y-%m-%d %H:%M', time.localtime(fired_at))}")

        if target.startswith("fleet:"):
            t = threading.Thread(
                target=run_fleet_job,
                args=(job_id, target.split(":", 1)[1], command),
                daemon=True)
        elif target in ("cloud", "selfhosted"):
            t = threading.Thread(
                target=run_agent_job,
                args=(job_id, target, cron_prompt),
                daemon=True)
        else:
            emit(job_id, "err", f"[cron] unknown target: {target}")
            finish(job_id, "error")
            nxt = compute_next_run(job["schedule"], fired_at) or (fired_at + 3600)
            db_advance_cron(job["id"], fired_at, nxt)
            return

        t.start()
        nxt = compute_next_run(job["schedule"], fired_at) or (fired_at + 3600)
        db_advance_cron(job["id"], fired_at, nxt)
        print(f"[cron] '{job['name']}' -> {job_id}  "
              f"next={time.strftime('%Y-%m-%d %H:%M', time.localtime(nxt))}")


CRON_SCHEDULER = CronScheduler()

# ---------------------------------------------------------------------------
# health checks
# ---------------------------------------------------------------------------


def get_machine_health(machine: str) -> dict:
    host = FLEET_HOSTS.get(machine)
    cmd = r"""
disk=$(df / 2>/dev/null | tail -1 | awk '{gsub(/%/,"",$5); print $5}') || disk="?";
if command -v free >/dev/null 2>&1; then
  mem=$(free -m | awk 'NR==2{print $3" "$2}');
else
  pages=$(vm_stat 2>/dev/null | awk '/Pages active/{gsub(/\./,"",$3);print $3+0}');
  total=$(sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1048576)}');
  used=$((pages*4/1024)); mem="$used $total";
fi;
load=$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}' || uptime | awk -F'[,:]' '{gsub(/ /,"",$NF); print $NF}');
printf "%s\n%s\n%s\n" "$disk" "$mem" "$load"
"""
    argv = (["bash", "-lc", cmd] if host is None
            else ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", host, cmd])
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=10)
        lines = (p.stdout or "").strip().split("\n")
        disk_pct = lines[0].strip() if lines else "?"
        mem_parts = lines[1].split() if len(lines) > 1 else []
        mem_used  = mem_parts[0] if mem_parts else "?"
        mem_total = mem_parts[1] if len(mem_parts) > 1 else "?"
        load1     = lines[2].strip() if len(lines) > 2 else "?"
        return {
            "machine":   machine,
            "status":    "ok",
            "disk_pct":  disk_pct,
            "mem_used":  mem_used,
            "mem_total": mem_total,
            "load1":     load1,
            "checked":   time.time(),
        }
    except subprocess.TimeoutExpired:
        return {"machine": machine, "status": "timeout", "checked": time.time()}
    except Exception as e:
        return {"machine": machine, "status": "error", "error": str(e), "checked": time.time()}

# ---------------------------------------------------------------------------
# in-memory job state
# ---------------------------------------------------------------------------

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()


def new_job(target: str, prompt: str) -> str:
    job_id = uuid.uuid4().hex[:12]
    title = prompt[:60] + ("..." if len(prompt) > 60 else "")
    with JOBS_LOCK:
        JOBS[job_id] = {
            "queue": queue.Queue(), "target": target, "prompt": prompt,
            "status": "running", "started": time.time(),
        }
    db_create_session(job_id, target, prompt, title)
    return job_id


def emit(job_id: str, kind: str, text: str) -> None:
    JOBS[job_id]["queue"].put({"kind": kind, "text": text})
    db_append_message(job_id, kind, text)


def finish(job_id: str, status: str = "done",
           anthropic_id: str | None = None,
           tokens_in: int = 0, tokens_out: int = 0) -> None:
    JOBS[job_id]["status"] = status
    JOBS[job_id]["queue"].put(None)
    db_finish_session(job_id, status, anthropic_id, tokens_in, tokens_out)

# ---------------------------------------------------------------------------
# target: direct fleet machine
# ---------------------------------------------------------------------------


def run_fleet_job(job_id: str, machine: str, command: str) -> None:
    host = FLEET_HOSTS.get(machine)
    argv = (["bash", "-lc", command] if host is None
            else ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", host, command])
    emit(job_id, "fleet", json.dumps({"machine": machine, "command": command}))
    try:
        proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, bufsize=1)
        out_lines: list[str] = []
        for line in proc.stdout:
            stripped = line.rstrip("\n")
            out_lines.append(stripped)
            emit(job_id, "out", stripped)
        proc.wait(timeout=300)
        emit(job_id, "fleet_result", json.dumps({
            "output": "\n".join(out_lines[-10:]),
            "exit": proc.returncode,
        }))
        finish(job_id, "done" if proc.returncode == 0 else "error")
    except Exception as e:
        emit(job_id, "err", str(e))
        finish(job_id, "error")

# ---------------------------------------------------------------------------
# target: managed agent sessions
# ---------------------------------------------------------------------------


def get_client():
    import anthropic
    return anthropic.Anthropic(api_key=load_env().get("ANTHROPIC_API_KEY"))


def run_fleet_command(machine: str, command: str) -> tuple[str, bool]:
    host = FLEET_HOSTS.get(machine)
    if machine not in FLEET_HOSTS:
        return f"Unknown machine {machine}", True
    argv = (["bash", "-lc", command] if host is None
            else ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", host, command])
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return "timed out after 120s", True
    return ((p.stdout or "") + (p.stderr or "")).strip() or "(no output)", p.returncode != 0


def run_agent_job(job_id: str, which: str, prompt: str) -> None:
    cfg = load_env()
    agent_id = cfg.get("AGENT_CLOUD_ID" if which == "cloud" else "AGENT_SELFHOSTED_ID")
    env_id   = cfg.get("CLOUD_ENV_ID"   if which == "cloud" else "SELFHOSTED_ENV_ID")
    if not (agent_id and env_id and cfg.get("ANTHROPIC_API_KEY")):
        emit(job_id, "err",
             "Not provisioned — click Provision (needs ANTHROPIC_API_KEY in .env).")
        finish(job_id, "error")
        return
    anthropic_id = None
    tokens_in = tokens_out = 0
    try:
        client = get_client()
        vaults = [v] if (v := cfg.get("GITHUB_VAULT_ID")) else []
        session = client.beta.sessions.create(
            agent=agent_id, environment_id=env_id, vault_ids=vaults,
            title=f"Fleet dispatch ({which})")
        anthropic_id = session.id
        emit(job_id, "info",
             f"session {session.id} — "
             f"https://platform.claude.com/workspaces/default/sessions/{session.id}")
        stream = client.beta.sessions.events.stream(session_id=session.id)
        client.beta.sessions.events.send(
            session_id=session.id,
            events=[{"type": "user.message",
                     "content": [{"type": "text", "text": prompt}]}])
        for event in stream:
            if event.type == "agent.message":
                for block in event.content:
                    btype = getattr(block, "type", "")
                    if btype == "thinking":
                        emit(job_id, "thinking", getattr(block, "thinking", ""))
                    elif btype == "text":
                        emit(job_id, "out", block.text)
            elif event.type == "agent.tool_use":
                inp = getattr(event, "input", {}) or {}
                emit(job_id, "tool", json.dumps({"name": event.name, "input": inp}))
            elif event.type == "agent.custom_tool_use" and event.name == "fleet_exec":
                m, c = event.input["machine"], event.input["command"]
                emit(job_id, "fleet", json.dumps({"machine": m, "command": c}))
                output, is_err = run_fleet_command(m, c)
                emit(job_id, "fleet_result", json.dumps({
                    "output": output, "exit": 0 if not is_err else 1,
                }))
                client.beta.sessions.events.send(
                    session_id=session.id,
                    events=[{"type": "user.custom_tool_result",
                             "custom_tool_use_id": event.id,
                             "content": [{"type": "text", "text": output}],
                             "is_error": is_err}])
            elif event.type == "session.error":
                emit(job_id, "err", str(getattr(event, "error", event)))
            elif event.type == "session.status_terminated":
                finish(job_id, "error", anthropic_id, tokens_in, tokens_out)
                return
            elif event.type == "session.status_idle":
                sr = getattr(event, "stop_reason", None)
                if getattr(sr, "type", "") != "requires_action":
                    finish(job_id, "done", anthropic_id, tokens_in, tokens_out)
                    return
    except Exception as e:
        emit(job_id, "err", f"{type(e).__name__}: {e}")
        finish(job_id, "error", anthropic_id, tokens_in, tokens_out)

# ---------------------------------------------------------------------------
# provisioning
# ---------------------------------------------------------------------------


def run_provision_job(job_id: str) -> None:
    py = os.path.join(ROOT, ".venv", "bin", "python")
    if not os.path.exists(py):
        py = "python3"
    emit(job_id, "info", "Running setup.py (creates environments + agents + vault)...")
    try:
        p = subprocess.Popen([py, "setup.py"], cwd=ROOT, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, bufsize=1)
        for line in p.stdout:
            emit(job_id, "out", line.rstrip("\n"))
        p.wait(timeout=300)
        finish(job_id, "done" if p.returncode == 0 else "error")
    except Exception as e:
        emit(job_id, "err", str(e))
        finish(job_id, "error")

# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------


def status_payload() -> dict:
    cfg = load_env()
    with DB_LOCK, sqlite3.connect(DB_PATH) as con:
        total = con.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        cron_enabled = con.execute(
            "SELECT COUNT(*) FROM cron_jobs WHERE enabled=1").fetchone()[0]
    return {
        "api_key":          bool(cfg.get("ANTHROPIC_API_KEY")),
        "cloud_agent":      bool(cfg.get("AGENT_CLOUD_ID")),
        "selfhosted_agent": bool(cfg.get("AGENT_SELFHOSTED_ID")),
        "github_vault":     bool(cfg.get("GITHUB_VAULT_ID")),
        "fleet":            list(FLEET_HOSTS.keys()),
        "session_count":    total,
        "active_crons":     cron_enabled,
        "jobs": {jid: {"target": j["target"], "status": j["status"],
                       "prompt": j["prompt"][:80]}
                 for jid, j in JOBS.items()},
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def do_GET(self):
        parsed = urlparse(self.path)
        path   = parsed.path
        qs     = parsed.query

        if path == "/":
            body = HTML.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif path == "/api/status":
            self._json(status_payload())

        elif path == "/api/health":
            results: list[dict] = []
            lock = threading.Lock()
            def check(m):
                r = get_machine_health(m)
                with lock:
                    results.append(r)
            threads = [threading.Thread(target=check, args=(m,), daemon=True)
                       for m in FLEET_HOSTS]
            for t in threads: t.start()
            for t in threads: t.join(timeout=12)
            self._json(results)

        elif path == "/api/cron":
            self._json(db_list_cron())

        elif path == "/api/sessions":
            search = ""
            for part in qs.split("&"):
                if part.startswith("q="):
                    search = part[2:].replace("+", " ").replace("%20", " ")
            self._json(db_list_sessions(search))

        elif path.startswith("/api/sessions/") and path.endswith("/export.md"):
            sid = path.split("/")[3]
            s = db_get_session(sid)
            if not s:
                self._json({"error": "not found"}, 404); return
            md = session_to_markdown(s).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/markdown; charset=utf-8")
            self.send_header("Content-Disposition",
                             f'attachment; filename="session-{sid}.md"')
            self.send_header("Content-Length", str(len(md)))
            self.end_headers()
            self.wfile.write(md)

        elif path.startswith("/api/sessions/") and path.endswith("/export.json"):
            sid = path.split("/")[3]
            s = db_get_session(sid)
            if not s:
                self._json({"error": "not found"}, 404); return
            body = json.dumps(s, default=str, indent=2).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Disposition",
                             f'attachment; filename="session-{sid}.json"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif path.startswith("/api/sessions/"):
            sid = path.rsplit("/", 1)[-1]
            s = db_get_session(sid)
            self._json(s if s else {"error": "not found"}, 200 if s else 404)

        elif path.startswith("/api/stream/"):
            job_id = path.rsplit("/", 1)[-1]
            job = JOBS.get(job_id)
            if not job:
                self._json({"error": "no such job"}, 404); return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            q = job["queue"]
            try:
                while True:
                    try:
                        item = q.get(timeout=25)
                    except queue.Empty:
                        self.wfile.write(b": heartbeat\n\n")
                        self.wfile.flush()
                        continue
                    if item is None:
                        self.wfile.write(
                            f"data: {json.dumps({'kind':'end','status':job['status']})}\n\n"
                            .encode())
                        self.wfile.flush()
                        break
                    self.wfile.write(f"data: {json.dumps(item)}\n\n".encode())
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass

        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        data = self._body()

        if self.path == "/api/dispatch":
            target = data.get("target", "")
            prompt = data.get("prompt", "").strip()
            if not prompt and target != "provision":
                self._json({"error": "empty prompt"}, 400); return
            job_id = new_job(target, prompt or "(provision)")
            if target.startswith("fleet:"):
                t = threading.Thread(target=run_fleet_job,
                                     args=(job_id, target.split(":", 1)[1], prompt),
                                     daemon=True)
            elif target in ("cloud", "selfhosted"):
                t = threading.Thread(target=run_agent_job,
                                     args=(job_id, target, prompt), daemon=True)
            elif target == "provision":
                t = threading.Thread(target=run_provision_job,
                                     args=(job_id,), daemon=True)
            else:
                self._json({"error": f"unknown target {target}"}, 400); return
            t.start()
            self._json({"job_id": job_id})

        elif self.path == "/api/cron":
            name    = data.get("name", "").strip()
            schedule= data.get("schedule", "").strip()
            target  = data.get("target", "").strip()
            command = data.get("command", "").strip()
            if not all([name, schedule, target, command]):
                self._json({"error": "name, schedule, target, command required"}, 400); return
            cid = db_create_cron(name, schedule, target, command)
            self._json({"id": cid})

        elif self.path.endswith("/run") and "/api/cron/" in self.path:
            cid = self.path.split("/")[3]
            crons = db_list_cron()
            job_def = next((c for c in crons if c["id"] == cid), None)
            if not job_def:
                self._json({"error": "not found"}, 404); return
            job_id = new_job(job_def["target"], job_def["command"])
            if job_def["target"].startswith("fleet:"):
                t = threading.Thread(target=run_fleet_job,
                                     args=(job_id, job_def["target"].split(":",1)[1],
                                           job_def["command"]), daemon=True)
            elif job_def["target"] in ("cloud", "selfhosted"):
                t = threading.Thread(target=run_agent_job,
                                     args=(job_id, job_def["target"], job_def["command"]),
                                     daemon=True)
            else:
                self._json({"error": "unsupported target"}, 400); return
            t.start()
            now = time.time()
            nxt = compute_next_run(job_def["schedule"], now)
            db_advance_cron(cid, now, nxt)
            self._json({"job_id": job_id})

        else:
            self._json({"error": "not found"}, 404)

    def do_PUT(self):
        data = self._body()
        if self.path.startswith("/api/cron/"):
            cid = self.path.split("/")[3]
            allowed = {k: v for k, v in data.items()
                       if k in ("name", "schedule", "target", "command", "enabled")}
            ok = db_update_cron(cid, **allowed)
            self._json({"ok": ok})
        else:
            self._json({"error": "not found"}, 404)

    def do_DELETE(self):
        if self.path.startswith("/api/sessions/"):
            sid = self.path.rsplit("/", 1)[-1]
            self._json({"ok": db_delete_session(sid)})
        elif self.path.startswith("/api/cron/"):
            cid = self.path.rsplit("/", 1)[-1]
            self._json({"ok": db_delete_cron(cid)})
        else:
            self._json({"error": "not found"}, 404)

# ---------------------------------------------------------------------------
# frontend (HTML lives below — single self-contained file)
# ---------------------------------------------------------------------------

HTML = r"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fleet Dispatcher</title>
<style>
:root{
  --bg:#08090c;--sidebar:#0b0e14;--panel:#0f1318;--raise:#141a23;--card:#111620;
  --edge:#1a2332;--edge2:#22304a;--ink:#d6e4f7;--dim:#6b7d94;--faint:#2d3f55;
  --blue:#3b82f6;--blue-dim:#1d3461;--green:#22c55e;--green-dim:#14532d;
  --red:#ef4444;--red-dim:#450a0a;--amber:#f59e0b;--amber-dim:#451a03;
  --purple:#a78bfa;--purple-dim:#2e1065;--cyan:#06b6d4;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --r:8px;--rl:12px;--sw:280px;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-font-smoothing:antialiased}
html,body{height:100%;overflow:hidden}
body{background:var(--bg);color:var(--ink);font:13px/1.5 -apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--edge2);border-radius:99px}

/* topbar */
.topbar{display:flex;align-items:center;gap:12px;height:50px;padding:0 16px;
  border-bottom:1px solid var(--edge);background:var(--sidebar);flex-shrink:0;z-index:10}
.burger{display:none;flex-direction:column;gap:4px;cursor:pointer;padding:6px;border:none;background:none}
.burger span{display:block;width:18px;height:2px;background:var(--dim);border-radius:1px}
.brand{font-size:15px;font-weight:700;letter-spacing:.04em;white-space:nowrap}
.brand em{color:var(--blue);font-style:normal}
.pills{display:flex;gap:5px;flex:1;flex-wrap:wrap;min-width:0}
.pill{border:1px solid var(--edge);border-radius:99px;padding:2px 9px;font-size:10px;color:var(--dim);white-space:nowrap}
.pill.on{color:var(--green);border-color:var(--green-dim);background:#0a1f0e}
.pill.off{color:var(--amber);border-color:var(--amber-dim);background:#1a0e00}
.tcount{font-size:11px;color:var(--dim);white-space:nowrap}

/* layout */
.layout{display:flex;flex:1;overflow:hidden;position:relative}

/* sidebar */
.sidebar{width:var(--sw);flex-shrink:0;border-right:1px solid var(--edge);
  background:var(--sidebar);display:flex;flex-direction:column;overflow:hidden;transition:transform .25s}
.sidebar-hd{padding:10px 12px 8px;border-bottom:1px solid var(--edge);flex-shrink:0;display:flex;flex-direction:column;gap:6px}
.sidebar-title{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--dim)}
.search-wrap{position:relative}
.search{width:100%;background:var(--raise);border:1px solid var(--edge);border-radius:var(--r);
  color:var(--ink);padding:6px 10px 6px 28px;font-size:12px;outline:none;transition:border-color .15s}
.search:focus{border-color:var(--blue)}
.si{position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--dim);font-size:12px;pointer-events:none}
.chips{display:flex;gap:4px;flex-wrap:wrap}
.chip{border:1px solid var(--edge);border-radius:99px;padding:1px 8px;font-size:10px;
  color:var(--dim);cursor:pointer;background:transparent;transition:all .12s}
.chip:hover{color:var(--ink);border-color:var(--edge2)}
.chip.active{color:#fff;border-color:var(--blue);background:var(--blue-dim)}
.sess-list{flex:1;overflow-y:auto;padding:3px 0}
.sess-item{padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--edge);position:relative;transition:background .1s}
.sess-item:hover,.sess-item.hi{background:var(--raise)}
.sess-item.hi{border-left:2px solid var(--blue)}
.t-lbl{font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
  padding:1px 5px;border-radius:4px;display:inline-block;margin-bottom:2px}
.t-cloud{background:#1d3461;color:#93c5fd}.t-selfhosted{background:#1a2940;color:#7dd3fc}
.t-fleet{background:#1a2e1a;color:#86efac}.t-provision{background:#2a1a3a;color:#c4b5fd}
.sp{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px}
.sm{font-size:10px;color:var(--dim);display:flex;gap:5px;align-items:center}
.sdot{width:6px;height:6px;border-radius:50%;display:inline-block;flex-shrink:0}
.sdot.running{background:var(--blue);animation:pulse 1.2s infinite}
.sdot.done{background:var(--green)}.sdot.error{background:var(--red)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.sdel{position:absolute;right:7px;top:7px;background:none;border:none;
  color:var(--faint);font-size:12px;cursor:pointer;opacity:0;padding:2px 5px;border-radius:4px;line-height:1}
.sess-item:hover .sdel{opacity:1}
.sdel:hover{color:var(--red)}
.sempty{padding:24px 12px;color:var(--dim);font-size:12px;text-align:center;line-height:2}

/* main */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}

/* dispatch */
.dw{padding:11px 14px;border-bottom:1px solid var(--edge);flex-shrink:0;background:var(--panel)}
.dr{display:flex;gap:9px;align-items:flex-start}
textarea{flex:1;background:var(--raise);border:1px solid var(--edge);border-radius:var(--r);
  color:var(--ink);padding:9px 11px;font:13px/1.4 var(--mono);min-height:62px;resize:vertical;outline:none;transition:border-color .15s}
textarea:focus{border-color:var(--blue)}
.ctls{display:flex;flex-direction:column;gap:6px;flex-shrink:0}
select{background:var(--raise);border:1px solid var(--edge);border-radius:var(--r);
  color:var(--ink);padding:7px 9px;font-size:12px;cursor:pointer;outline:none;min-width:155px}
.btn{background:var(--raise);border:1px solid var(--edge);border-radius:var(--r);
  color:var(--ink);padding:7px 13px;font-size:12px;cursor:pointer;white-space:nowrap;
  text-decoration:none;display:inline-flex;align-items:center;gap:5px;transition:all .1s;min-height:30px}
.btn:hover{border-color:var(--edge2)}
.btn.pri{background:var(--blue);border-color:var(--blue);color:#fff;font-weight:600}
.btn.pri:hover{filter:brightness(1.12)}
.btn.gh{color:var(--dim);border-color:transparent;background:transparent}
.btn.gh:hover{color:var(--ink);background:var(--raise)}
.btn.dn{color:var(--red);border-color:var(--red-dim);background:transparent}
.btn.dn:hover{background:var(--red-dim)}
.btn.xs{padding:3px 9px;font-size:11px;min-height:24px}
.qr{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}
.qb{background:transparent;border:1px solid var(--edge);border-radius:5px;
  color:var(--dim);padding:3px 8px;font-size:11px;cursor:pointer;transition:all .12s;min-height:24px}
.qb:hover{color:var(--ink);border-color:var(--edge2);background:var(--raise)}

/* tabs */
.tbr{display:flex;border-bottom:1px solid var(--edge);flex-shrink:0;background:var(--panel);padding:0 14px}
.tab{padding:8px 13px;font-size:12px;color:var(--dim);cursor:pointer;
  border-bottom:2px solid transparent;margin-bottom:-1px;user-select:none;white-space:nowrap;transition:color .12s}
.tab:hover{color:var(--ink)}
.tab.act{color:var(--blue);border-bottom-color:var(--blue)}
.tps{flex:1;overflow:hidden;display:flex;flex-direction:column}
.tp{display:none;flex:1;flex-direction:column;overflow:hidden}
.tp.act{display:flex}

/* jobs */
.jw{flex:1;overflow-y:auto;padding:11px 14px;display:flex;flex-direction:column;gap:9px}
.jcard{background:var(--card);border:1px solid var(--edge);border-radius:var(--rl);overflow:hidden}
.jhd{display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid var(--edge);background:var(--panel)}
.jtb{font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;flex-shrink:0}
.jp{flex:1;font-size:12px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jst{font-size:10px;font-weight:700;letter-spacing:.05em;flex-shrink:0}
.js-running{color:var(--blue)}.js-done{color:var(--green)}.js-error{color:var(--red)}
.jout{font:12px/1.7 var(--mono);padding:8px 12px;max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:1px}

/* message kinds */
.lo{color:var(--ink)}.li{color:var(--dim);font-style:italic}.le{color:var(--red)}
.mo{color:var(--ink)}.mi{color:var(--dim);font-style:italic}.me{color:var(--red)}
.mt{color:var(--purple)}.mf{color:var(--amber)}.mfr{color:var(--cyan)}.mth{color:var(--dim);font-style:italic}

/* thinking */
.bth{border:1px solid var(--edge);border-radius:6px;margin:2px 0}
.thh{display:flex;align-items:center;gap:6px;padding:5px 9px;cursor:pointer;
  color:var(--dim);font-size:11px;font-style:italic;user-select:none;background:rgba(255,255,255,.02)}
.thh:hover{background:rgba(255,255,255,.04)}
.tha{font-size:9px;transition:transform .2s;color:var(--faint)}
.bth.o .tha{transform:rotate(90deg)}
.thb{display:none;padding:6px 9px;border-top:1px solid var(--edge);
  color:var(--dim);font-style:italic;font-size:11px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
.bth.o .thb{display:block}

/* tool */
.btl{border:1px solid var(--purple-dim);border-radius:6px;margin:2px 0}
.tlh{display:flex;align-items:center;gap:6px;padding:5px 9px;cursor:pointer;
  color:var(--purple);font-size:11px;user-select:none;background:rgba(167,139,250,.04)}
.tlh:hover{background:rgba(167,139,250,.07)}
.tln{font-weight:600}
.tlx{color:var(--faint);font-size:10px;margin-left:auto}
.tla{font-size:9px;transition:transform .2s;color:var(--purple);opacity:.5}
.btl.o .tla{transform:rotate(90deg)}
.tlb{display:none;padding:7px 9px;border-top:1px solid var(--purple-dim);
  color:var(--dim);font-size:11px;line-height:1.6;white-space:pre;overflow-x:auto}
.btl.o .tlb{display:block}

/* fleet */
.bfl{display:flex;align-items:center;gap:7px;padding:3px 0;font-size:12px}
.mb{font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:2px 6px;border-radius:4px;flex-shrink:0}
.bwh{background:var(--green-dim);color:#86efac}
.bad{background:var(--blue-dim);color:#93c5fd}
.bqk{background:var(--amber-dim);color:#fcd34d}
.fc{color:var(--amber);font-family:var(--mono)}
.bfr{border:1px solid var(--edge);border-radius:6px;margin:2px 0}
.frh{display:flex;align-items:center;gap:7px;padding:4px 9px;font-size:11px}
.exok{color:var(--green);font-weight:700}.exer{color:var(--red);font-weight:700}
.frb{padding:4px 9px;font-size:11px;color:var(--dim);white-space:pre-wrap;
  border-top:1px solid var(--edge);max-height:100px;overflow-y:auto;word-break:break-all}

/* health */
.hw{flex:1;overflow-y:auto;padding:14px}
.hgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:11px}
.hcard{background:var(--card);border:1px solid var(--edge);border-radius:var(--rl);padding:14px}
.hch{display:flex;align-items:center;gap:9px;margin-bottom:11px}
.hm{font-size:13px;font-weight:700;letter-spacing:.04em}
.hdot{width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-left:auto}
.dok{background:var(--green);box-shadow:0 0 5px var(--green)}
.dwn{background:var(--amber);box-shadow:0 0 5px var(--amber)}
.der{background:var(--red);box-shadow:0 0 5px var(--red)}
.duk{background:var(--dim)}
.hr{display:flex;justify-content:space-between;align-items:center;
  padding:5px 0;border-bottom:1px solid var(--edge);font-size:12px}
.hr:last-child{border:none}
.hl{color:var(--dim)}.hv{font-family:var(--mono)}
.hv.w{color:var(--amber)}.hv.c{color:var(--red)}
.hck{font-size:10px;color:var(--faint);margin-top:9px}
.href{display:flex;justify-content:flex-end;margin-bottom:10px}
.hsm{font-size:12px;color:var(--dim);padding:12px;text-align:center}

/* cron */
.crw{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:11px}
.cradd{background:var(--card);border:1px solid var(--edge);border-radius:var(--rl);padding:13px}
.cradd h3{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--dim);margin-bottom:9px}
.crform{display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:7px;align-items:end}
.fg{display:flex;flex-direction:column;gap:3px}
.fg label{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.07em}
.fi{background:var(--raise);border:1px solid var(--edge);border-radius:var(--r);
  color:var(--ink);padding:6px 9px;font-size:12px;outline:none;width:100%;transition:border-color .15s}
.fi:focus{border-color:var(--blue)}
.crtw{background:var(--card);border:1px solid var(--edge);border-radius:var(--rl);overflow:hidden}
.crt{width:100%;border-collapse:collapse;font-size:12px}
.crt th{background:var(--panel);padding:7px 11px;text-align:left;font-size:10px;
  text-transform:uppercase;letter-spacing:.08em;color:var(--dim);border-bottom:1px solid var(--edge)}
.crt td{padding:7px 11px;border-bottom:1px solid var(--edge);vertical-align:middle}
.crt tr:last-child td{border:none}
.crt tr:hover td{background:var(--raise)}
.crm{font-family:var(--mono);color:var(--amber)}
.tgl{width:32px;height:17px;background:var(--faint);border-radius:99px;position:relative;
  cursor:pointer;border:none;transition:background .2s;flex-shrink:0}
.tgl.on{background:var(--blue)}
.tgl::after{content:'';position:absolute;width:13px;height:13px;border-radius:50%;
  background:#fff;top:2px;left:2px;transition:left .18s}
.tgl.on::after{left:17px}
.cra{display:flex;gap:5px;align-items:center}
.crem{padding:28px;text-align:center;color:var(--dim);font-size:12px}

/* overlay */
.ovl{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:100;
  display:none;align-items:center;justify-content:center;backdrop-filter:blur(3px)}
.ovl.sh{display:flex}
.dbox{background:var(--panel);border:1px solid var(--edge);border-radius:var(--rl);
  width:860px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;
  box-shadow:0 24px 64px rgba(0,0,0,.6)}
.dhd{display:flex;align-items:center;gap:10px;padding:13px 17px;border-bottom:1px solid var(--edge);flex-shrink:0}
.dhd h3{flex:1;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dmt{display:flex;gap:10px;font-size:11px;color:var(--dim);flex-wrap:wrap;
  padding:8px 17px;border-bottom:1px solid var(--edge);flex-shrink:0}
.dmt strong{color:var(--ink)}
.dtr{flex:1;overflow-y:auto;padding:11px 17px;font:12px/1.8 var(--mono);display:flex;flex-direction:column;gap:2px}
.dft{display:flex;gap:7px;padding:11px 17px;border-top:1px solid var(--edge);flex-shrink:0;flex-wrap:wrap}
.mts{color:var(--faint);font-size:10px;margin-right:5px;user-select:none}
.mrow{display:flex;align-items:baseline;gap:4px;white-space:pre-wrap;word-break:break-word;line-height:1.6}

/* empty */
.es{padding:36px 20px;color:var(--dim);font-size:12px;text-align:center;line-height:2.2}
.es .big{font-size:26px;display:block;margin-bottom:6px;opacity:.3}

/* toast */
.toast{position:fixed;bottom:18px;right:18px;background:var(--green-dim);border:1px solid var(--green);
  color:var(--green);padding:8px 14px;border-radius:var(--r);font-size:12px;z-index:200;
  opacity:0;transform:translateY(6px);transition:all .22s;pointer-events:none}
.toast.sh{opacity:1;transform:translateY(0)}

/* mobile */
@media(max-width:767px){
  .burger{display:flex}
  .pills{display:none}
  .sidebar{position:fixed;bottom:0;left:0;right:0;top:auto;width:100%;
    height:65vh;border-right:none;border-top:1px solid var(--edge);
    border-radius:18px 18px 0 0;z-index:50;transform:translateY(100%);
    box-shadow:0 -8px 32px rgba(0,0,0,.5)}
  .sidebar.mob{transform:translateY(0)}
  .sovl{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:49}
  .sovl.sh{display:block}
  .dr{flex-direction:column}
  .ctls{flex-direction:row;flex-wrap:wrap}
  textarea{min-height:72px}
  select{width:100%}
  .crform{grid-template-columns:1fr 1fr;gap:5px}
  .hgrid{grid-template-columns:1fr}
  .dbox{max-height:95vh;border-radius:var(--rl) var(--rl) 0 0;
    position:fixed;bottom:0;left:0;right:0;width:100%;max-width:100%}
}
</style>
</head><body>

<div class="topbar">
  <button class="burger" onclick="toggleSb()" aria-label="Menu">
    <span></span><span></span><span></span>
  </button>
  <div class="brand">Fleet <em>Dispatcher</em></div>
  <div class="pills" id="pills"></div>
  <div class="tcount" id="tc"></div>
</div>

<div class="sovl" id="sovl" onclick="toggleSb()"></div>

<div class="layout">
  <div class="sidebar" id="sb">
    <div class="sidebar-hd">
      <div class="sidebar-title">Session History</div>
      <div class="search-wrap">
        <span class="si">⌕</span>
        <input class="search" id="sq" placeholder="Search  (⌘K)" oninput="loadSess()">
      </div>
      <div class="chips">
        <button class="chip active" data-ft="target" data-fv="" onclick="setF('target','',this)">All</button>
        <button class="chip" data-ft="target" data-fv="cloud" onclick="setF('target','cloud',this)">Cloud</button>
        <button class="chip" data-ft="target" data-fv="selfhosted" onclick="setF('target','selfhosted',this)">Self-hosted</button>
        <button class="chip" data-ft="target" data-fv="fleet" onclick="setF('target','fleet',this)">Fleet</button>
        <button class="chip active" data-ft="status" data-fv="" onclick="setF('status','',this)">Any</button>
        <button class="chip" data-ft="status" data-fv="running" onclick="setF('status','running',this)">Running</button>
        <button class="chip" data-ft="status" data-fv="done" onclick="setF('status','done',this)">Done</button>
        <button class="chip" data-ft="status" data-fv="error" onclick="setF('status','error',this)">Error</button>
      </div>
    </div>
    <div class="sess-list" id="sl"></div>
  </div>

  <div class="main">
    <div class="dw">
      <div class="dr">
        <textarea id="prompt" placeholder="Enter task… (⌘↵ to dispatch)" rows="3"
          onkeydown="if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){dispatch();event.preventDefault()}"></textarea>
        <div class="ctls">
          <select id="tgt">
            <option value="cloud">☁ Cloud Agent</option>
            <option value="selfhosted">⚡ Self-Hosted</option>
            <option value="fleet:WORKHORSE">WORKHORSE</option>
            <option value="fleet:ADMIN">ADMIN</option>
            <option value="fleet:QUICKS">QUICKS</option>
            <option value="provision">⚙ Provision</option>
          </select>
          <button class="btn pri" onclick="dispatch()">▶ Dispatch</button>
          <button class="btn gh" onclick="$('prompt').value=''">Clear</button>
        </div>
      </div>
      <div class="qr">
        <button class="qb" onclick="q('Check disk + uptime on all fleet machines')">fleet health</button>
        <button class="qb" onclick="q('Report open Claude sessions and active jobs')">sessions</button>
        <button class="qb" onclick="q('Run docket-pull on all active cases and summarize new filings')">docket pull</button>
        <button class="qb" onclick="q('Scan ~/.secrets-quarantine and report any issues')">secrets audit</button>
        <button class="qb" onclick="q('Check ADMIN + QUICKS disk, memory, and uptime')">admin health</button>
        <button class="qb" onclick="q('OBBBA TAX — July 6 deadline status: confirm all filings complete or in progress')">OBBBA tax</button>
        <button class="qb" onclick="q('Morgan Drive MSJ — July 6 oral argument prep: summarize key points and anticipated questions')">Morgan MSJ</button>
        <button class="qb" onclick="q('Five9 audit status — unzip vols 01-05 and report call log summaries')">Five9 audit</button>
        <button class="qb" onclick="q('PAWS lead backup status — confirm latest backup timestamp and integrity')">PAWS backup</button>
        <button class="qb" onclick="q('Secrets rotation — check Workhorse Desktop for any expired or soon-expiring secrets')">secrets rotate</button>
      </div>
    </div>

    <div class="tbr">
      <div class="tab act" onclick="swTab('jobs',this)">Jobs</div>
      <div class="tab" onclick="swTab('cron',this)">Cron</div>
      <div class="tab" onclick="swTab('health',this)">Health</div>
    </div>

    <div class="tps">
      <div class="tp act" id="tp-jobs">
        <div class="jw" id="jobs">
          <div class="es"><span class="big">⚡</span>Dispatch a task to see live output.<br>Session history persists across restarts.</div>
        </div>
      </div>

      <div class="tp" id="tp-cron">
        <div class="crw">
          <div class="cradd">
            <h3>Add Cron Job</h3>
            <div class="crform">
              <div class="fg"><label>Name</label><input class="fi" id="crn" placeholder="Daily docket pull"></div>
              <div class="fg"><label>Schedule</label><input class="fi" id="crs" placeholder="0 9 * * *"></div>
              <div class="fg"><label>Target</label>
                <select class="fi" id="crt2">
                  <option value="cloud">Cloud Agent</option>
                  <option value="selfhosted">Self-Hosted</option>
                  <option value="fleet:WORKHORSE">WORKHORSE</option>
                  <option value="fleet:ADMIN">ADMIN</option>
                  <option value="fleet:QUICKS">QUICKS</option>
                </select>
              </div>
              <div class="fg"><label>Command / Prompt</label><input class="fi" id="crc" placeholder="Run docket-pull and summarize"></div>
              <button class="btn pri" onclick="addCron()" style="align-self:flex-end">Add</button>
            </div>
          </div>
          <div class="crtw">
            <table class="crt">
              <thead><tr><th>Name</th><th>Schedule</th><th>Target</th><th>Next Run</th><th>Last Run</th><th>Runs</th><th>On</th><th>Actions</th></tr></thead>
              <tbody id="crb"><tr><td colspan="8" class="crem">No cron jobs yet.</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="tp" id="tp-health">
        <div class="hw">
          <div class="href"><button class="btn xs" onclick="loadHealth()">↺ Refresh</button></div>
          <div class="hgrid" id="hg"><div class="hsm">Switch to this tab or click Refresh to load health data.</div></div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="ovl" id="ovl" onclick="if(event.target===this)closeD()">
  <div class="dbox">
    <div class="dhd">
      <h3 id="dtitle"></h3>
      <button class="btn gh xs" onclick="copyTr()">⎘ Copy</button>
      <button class="btn gh xs" onclick="closeD()">✕</button>
    </div>
    <div class="dmt" id="dmeta"></div>
    <div class="dtr" id="dtr"></div>
    <div class="dft" id="dft"></div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const ago = ts => { const d=Math.floor(Date.now()/1000-ts); return d<60?d+'s ago':d<3600?Math.floor(d/60)+'m ago':d<86400?Math.floor(d/3600)+'h ago':Math.floor(d/86400)+'d ago'; };
const fmt = n => n>=1000?(n/1000).toFixed(1)+'k tok':n+' tok';

let fT='', fS='', allSess=[], curId=null, hlDone=false;

function toast(msg,ms=2000){const t=$('toast');t.textContent=msg;t.classList.add('sh');setTimeout(()=>t.classList.remove('sh'),ms);}

function toggleSb(){const s=$('sb'),o=$('sovl');const op=s.classList.toggle('mob');o.classList.toggle('sh',op);}

function swTab(n,el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('act'));
  document.querySelectorAll('.tp').forEach(p=>p.classList.remove('act'));
  el.classList.add('act');$('tp-'+n).classList.add('act');
  if(n==='health'&&!hlDone){loadHealth();hlDone=true;}
  if(n==='cron')loadCron();
}

function setF(type,val,el){
  if(type==='target'){fT=val;document.querySelectorAll('[data-ft="target"]').forEach(c=>c.classList.remove('active'));}
  else{fS=val;document.querySelectorAll('[data-ft="status"]').forEach(c=>c.classList.remove('active'));}
  el.classList.add('active');renderSess();
}

async function refreshStatus(){
  try{
    const s=await fetch('/api/status').then(r=>r.json());
    const it={'API':s.api_key,'Cloud':s.cloud_agent,'Self':s.selfhosted_agent,'GH':s.github_vault};
    $('pills').innerHTML=Object.entries(it).map(([k,v])=>`<span class="pill ${v?'on':'off'}">${k}</span>`).join('');
    $('tc').textContent=s.session_count+' sessions';
  }catch(e){}
}

async function loadSess(){
  const q=$('sq').value;
  allSess=await fetch('/api/sessions'+(q?'?q='+encodeURIComponent(q):'')).then(r=>r.json()).catch(()=>[]);
  renderSess();
}

function renderSess(){
  const el=$('sl');
  let rows=allSess;
  if(fT)rows=rows.filter(s=>fT==='fleet'?s.target.startsWith('fleet'):s.target===fT);
  if(fS)rows=rows.filter(s=>s.status===fS);
  if(!rows.length){el.innerHTML='<div class="sempty">No sessions match filter.</div>';return;}
  const tm={cloud:'t-cloud',selfhosted:'t-selfhosted',provision:'t-provision'};
  el.innerHTML=rows.map(s=>{
    const tc=s.target.startsWith('fleet')?'t-fleet':(tm[s.target]||'t-cloud');
    const tok=(s.tokens_in||0)+(s.tokens_out||0);
    return `<div class="sess-item${curId===s.id?' hi':''}" onclick="openD('${s.id}')">
      <button class="sdel" onclick="event.stopPropagation();delSess('${s.id}')">✕</button>
      <span class="t-lbl ${tc}">${esc(s.target)}</span>
      <div class="sp">${esc(s.prompt||'(provision)')}</div>
      <div class="sm"><span class="sdot ${s.status}"></span>${s.status} · ${ago(s.created_at)}${tok?' · '+fmt(tok):''}</div>
    </div>`;
  }).join('');
}

async function delSess(id){
  if(!confirm('Delete session and transcript?'))return;
  await fetch('/api/sessions/'+id,{method:'DELETE'});
  if(curId===id)closeD();
  await loadSess();refreshStatus();
}

function mkNode(m){
  if(m.kind==='thinking'){
    const w=document.createElement('div');w.className='bth';
    w.innerHTML=`<div class="thh" onclick="this.parentElement.classList.toggle('o')"><span class="tha">&#9658;</span> Reasoning…</div><div class="thb">${esc(m.text)}</div>`;
    return w;
  }
  if(m.kind==='tool'){
    let p=null;try{p=JSON.parse(m.text);}catch(e){}
    if(p){
      const w=document.createElement('div');w.className='btl';
      const inp=JSON.stringify(p.input||{},null,2);
      w.innerHTML=`<div class="tlh" onclick="this.parentElement.classList.toggle('o')"><span class="tla">&#9658;</span><span class="tln">&#9881; ${esc(p.name||'tool')}</span><span class="tlx">expand</span></div><pre class="tlb">${esc(inp)}</pre>`;
      return w;
    }
  }
  if(m.kind==='fleet'){
    let p=null;try{p=JSON.parse(m.text);}catch(e){}
    if(p&&p.machine){
      const bc={WORKHORSE:'bwh',ADMIN:'bad',QUICKS:'bqk'}[p.machine]||'bwh';
      const w=document.createElement('div');w.className='bfl';
      w.innerHTML=`<span class="mb ${bc}">${esc(p.machine)}</span><span class="fc">$ ${esc(p.command||'')}</span>`;
      return w;
    }
  }
  if(m.kind==='fleet_result'){
    let p=null;try{p=JSON.parse(m.text);}catch(e){}
    if(p){
      const ec=p.exit===0?'exok':'exer';
      const w=document.createElement('div');w.className='bfr';
      w.innerHTML=`<div class="frh"><span class="${ec}">exit ${p.exit}</span></div><div class="frb">${esc(p.output||'')}</div>`;
      return w;
    }
  }
  const cls={out:'mo',info:'mi',err:'me',tool:'mt',fleet:'mf',fleet_result:'mfr',thinking:'mth'}[m.kind]||'mo';
  const sp=document.createElement('span');sp.className=cls;sp.textContent=m.text;return sp;
}

async function openD(id){
  curId=id;renderSess();
  const s=await fetch('/api/sessions/'+id).then(r=>r.json());
  $('dtitle').textContent=s.title||s.id;
  const dur=s.finished_at?(s.finished_at-s.created_at).toFixed(0)+'s':'running';
  $('dmeta').innerHTML=`<span><strong>Target:</strong> ${esc(s.target)}</span>
    <span><strong>Status:</strong> ${s.status}</span>
    <span><strong>Created:</strong> ${new Date(s.created_at*1000).toLocaleString()}</span>
    <span><strong>Duration:</strong> ${dur}</span>
    <span><strong>Tokens:</strong> ${s.tokens_in||0} in / ${s.tokens_out||0} out</span>
    ${s.anthropic_id?`<span><strong>Anthropic:</strong> <code>${esc(s.anthropic_id)}</code></span>`:''}`;
  const dtr=$('dtr');dtr.innerHTML='';
  if(!(s.messages||[]).length){dtr.innerHTML='<span style="color:var(--dim)">No messages.</span>';}
  else{
    for(const m of s.messages){
      const t=new Date(m.ts*1000).toLocaleTimeString();
      const row=document.createElement('div');row.className='mrow';
      const ts=document.createElement('span');ts.className='mts';ts.textContent=t;
      row.appendChild(ts);row.appendChild(mkNode(m));dtr.appendChild(row);
    }
  }
  $('dft').innerHTML=`<a href="/api/sessions/${id}/export.md" download class="btn xs">&#8595; .md</a>
    <a href="/api/sessions/${id}/export.json" download class="btn xs">&#8595; .json</a>
    <button class="btn xs gh" onclick="closeD()">Close</button>`;
  $('ovl').classList.add('sh');
}

function copyTr(){
  const t=$('dtr').innerText||$('dtr').textContent;
  navigator.clipboard.writeText(t).then(()=>toast('Copied'));
}

function closeD(){$('ovl').classList.remove('sh');curId=null;renderSess();}

function q(txt){$('prompt').value=txt;$('prompt').focus();}

async function dispatch(){
  const prompt=$('prompt').value.trim();
  const target=$('tgt').value;
  if(!prompt&&target!=='provision')return;
  $('prompt').value='';
  const res=await fetch('/api/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({target,prompt})}).then(r=>r.json());
  if(res.error){alert(res.error);return;}
  addCard(res.job_id,target,prompt);
  document.querySelectorAll('.tab')[0].click();
  loadSess();refreshStatus();
}

function addCard(id,target,prompt){
  const tm={cloud:'t-cloud',selfhosted:'t-selfhosted',provision:'t-provision'};
  const tc=target.startsWith('fleet')?'t-fleet':(tm[target]||'t-cloud');
  const wrap=$('jobs');
  const ph=wrap.querySelector('.es');if(ph)ph.remove();
  const card=document.createElement('div');card.className='jcard';card.id='jc-'+id;
  card.innerHTML=`<div class="jhd"><span class="jtb ${tc}">${esc(target)}</span><span class="jp">${esc(prompt||'(provision)')}</span><span class="jst js-running" id="jst-${id}">RUNNING</span></div><div class="jout" id="jout-${id}"></div>`;
  wrap.insertBefore(card,wrap.firstChild);
  const src=new EventSource('/api/stream/'+id);
  const out=$('jout-'+id);
  src.onmessage=e=>{
    const m=JSON.parse(e.data);
    if(m.kind==='end'){
      src.close();
      const st=$('jst-'+id);
      if(st){st.textContent=m.status.toUpperCase();st.className='jst js-'+m.status;}
      loadSess();refreshStatus();return;
    }
    if(['out','info','err'].includes(m.kind)){
      const div=document.createElement('div');
      div.className={out:'lo',info:'li',err:'le'}[m.kind];div.textContent=m.text;
      out.appendChild(div);
    }else{out.appendChild(mkNode(m));}
    out.scrollTop=out.scrollHeight;
  };
}

async function loadHealth(){
  const g=$('hg');g.innerHTML='<div class="hsm">Checking machines…</div>';
  try{
    const rs=await fetch('/api/health').then(r=>r.json());
    g.innerHTML='';
    for(const h of rs){
      const bc={WORKHORSE:'bwh',ADMIN:'bad',QUICKS:'bqk'}[h.machine]||'bwh';
      let dc='duk',dt='Unknown';
      if(h.status==='ok'){const d=parseInt(h.disk_pct)||0;dc=d>90?'der':d>75?'dwn':'dok';dt=d>90?'Critical':d>75?'Warn':'OK';}
      else if(h.status==='timeout'){dc='der';dt='Timeout';}
      else if(h.status==='error'){dc='der';dt='Error';}
      const card=document.createElement('div');card.className='hcard';
      const dk=parseInt(h.disk_pct)||0;const dvc=dk>90?'c':dk>75?'w':'';
      if(h.status!=='ok'){
        card.innerHTML=`<div class="hch"><span class="mb ${bc}">${esc(h.machine)}</span><div class="hm">${esc(h.machine)}</div><span class="hdot ${dc}" title="${dt}"></span></div>
          <div class="hr"><span class="hl">Status</span><span class="hv c">${esc(h.status)}</span></div>
          ${h.error?`<div class="hr"><span class="hl">Error</span><span class="hv">${esc(h.error)}</span></div>`:''}
          <div class="hck">Checked ${ago(h.checked)}</div>`;
      }else{
        const mp=h.mem_total&&h.mem_total!='?'?Math.round(parseInt(h.mem_used)/parseInt(h.mem_total)*100):null;
        const mvc=mp!=null?(mp>90?'c':mp>75?'w':''):'';
        card.innerHTML=`<div class="hch"><span class="mb ${bc}">${esc(h.machine)}</span><div class="hm">${esc(h.machine)}</div><span class="hdot ${dc}" title="${dt}"></span></div>
          <div class="hr"><span class="hl">Disk</span><span class="hv ${dvc}">${esc(h.disk_pct)}%</span></div>
          <div class="hr"><span class="hl">Memory</span><span class="hv ${mvc}">${esc(h.mem_used)} / ${esc(h.mem_total)} MB${mp!=null?' ('+mp+'%)':''}</span></div>
          <div class="hr"><span class="hl">Load</span><span class="hv">${esc(h.load1)}</span></div>
          <div class="hck">Checked ${ago(h.checked)}</div>`;
      }
      g.appendChild(card);
    }
  }catch(e){$('hg').innerHTML='<div class="hsm" style="color:var(--red)">Health check failed.</div>';}
}

function fmtNext(ts){
  if(!ts)return'<span style="color:var(--faint)">—</span>';
  const d=new Date(ts*1000),now=new Date(),diffH=(d-now)/3600000;
  if(diffH<0)return`<span style="color:var(--dim)">${d.toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>`;
  if(diffH<1)return`<span style="color:var(--green)">in ${Math.round(diffH*60)}m</span>`;
  if(diffH<24)return`<span style="color:var(--green)">in ${diffH.toFixed(1)}h (${d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})})</span>`;
  return`<span style="color:var(--green)">${d.toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>`;
}

async function loadCron(){
  const js=await fetch('/api/cron').then(r=>r.json()).catch(()=>[]);
  const tb=$('crb');
  if(!js.length){tb.innerHTML='<tr><td colspan="8" class="crem">No cron jobs yet.</td></tr>';return;}
  const tm={cloud:'t-cloud',selfhosted:'t-selfhosted',provision:'t-provision'};
  tb.innerHTML=js.map(j=>{
    const tc=j.target.startsWith('fleet')?'t-fleet':(tm[j.target]||'t-cloud');
    const nxt=fmtNext(j.next_run);
    const lr=j.last_run?ago(j.last_run):'<span style="color:var(--faint)">never</span>';
    const rc=`<span style="color:var(--faint)">${j.run_count||0}</span>`;
    return `<tr>
      <td><strong>${esc(j.name)}</strong></td>
      <td><span class="crm">${esc(j.schedule)}</span></td>
      <td><span class="t-lbl ${tc}" style="font-size:9px">${esc(j.target)}</span></td>
      <td>${nxt}</td><td>${lr}</td><td>${rc}</td>
      <td><button class="tgl ${j.enabled?'on':''}" id="tgl-${j.id}" onclick="togCron('${j.id}',this)"></button></td>
      <td><div class="cra">
        <button class="btn xs" onclick="runCron('${j.id}')">&#9654; Run</button>
        <button class="btn xs dn" onclick="delCron('${j.id}')">&#10005;</button>
      </div></td>
    </tr>`;
  }).join('');
}

async function addCron(){
  const name=$('crn').value.trim(),schedule=$('crs').value.trim(),
    target=$('crt2').value,command=$('crc').value.trim();
  if(!name||!schedule||!command){toast('Fill all fields');return;}
  const r=await fetch('/api/cron',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name,schedule,target,command})}).then(r=>r.json());
  if(r.error){toast('Error: '+r.error);return;}
  $('crn').value='';$('crs').value='';$('crc').value='';
  toast('Cron job added');loadCron();
}

async function togCron(id,btn){
  const on=!btn.classList.contains('on');
  await fetch('/api/cron/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({enabled:on?1:0})});
  btn.classList.toggle('on',on);
}

async function runCron(id){
  const r=await fetch('/api/cron/'+id+'/run',{method:'POST'}).then(r=>r.json());
  if(r.error){toast('Error: '+r.error);return;}
  addCard(r.job_id,'cron','Cron run');
  document.querySelectorAll('.tab')[0].click();
  toast('Job started');loadSess();refreshStatus();loadCron();
}

async function delCron(id){
  if(!confirm('Delete cron job?'))return;
  await fetch('/api/cron/'+id,{method:'DELETE'});
  toast('Deleted');loadCron();
}

document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeD();
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){$('sq').focus();e.preventDefault();}
});

setInterval(()=>{if(!document.hidden&&hlDone)loadHealth();},30000);
refreshStatus();loadSess();
setInterval(()=>{refreshStatus();loadSess();},8000);
</script>
</body></html>"""

# ---------------------------------------------------------------------------
# entrypoint
# ---------------------------------------------------------------------------


def main() -> None:
    init_db()
    CRON_SCHEDULER.start()
    cron_jobs = db_list_cron()
    enabled   = sum(1 for j in cron_jobs if j.get("enabled"))
    print(f"Fleet Dispatcher  ->  http://127.0.0.1:{PORT}")
    print(f"Session DB        ->  {DB_PATH}")
    print(f"Cron scheduler    ->  {len(cron_jobs)} jobs, {enabled} enabled")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
