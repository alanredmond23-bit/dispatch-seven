"""Fleet Dispatcher UI — dispatch board + full settings/config control plane.

Dispatch prompts to cloud Managed Agents and the self-hosted fleet worker with live
multi-session streaming, AND manage the whole config surface from one place:
  - Agents: view/create/update (form or YAML), versioned
  - Environments: view/create (cloud / self_hosted)
  - Config files: edit MD / JSON / YAML / .env (settings.json, CLAUDE.md, agent YAML)
    sandboxed to allowlisted roots (the project dir + ~/.claude).

Run:  cd ~/Desktop/fleet-dispatcher && .venv/bin/python app.py
Open: http://127.0.0.1:8787
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import anthropic
import yaml
from dotenv import load_dotenv

load_dotenv()
load_dotenv(os.path.expanduser("~/MASTER_RULES/SECRETS.env"))

HERE = Path(__file__).parent
PORT = int(os.environ.get("FLEET_UI_PORT", "8787"))

FLEET_HOSTS = {"WORKHORSE": None, "ADMIN": "admin.local", "QUICKS": "quicks.local"}

# Config-file editor: only these roots are readable/writable, only these extensions.
FS_ROOTS = {
    "project": HERE.resolve(),
    "claude": Path(os.path.expanduser("~/.claude")).resolve(),
}
FS_EXTS = {".md", ".json", ".yaml", ".yml", ".env", ".txt"}

client = anthropic.Anthropic()

SESSIONS: dict[str, dict] = {}
LOCK = threading.Lock()


# ============================ fleet exec (host-side) ========================
def run_fleet_command(machine: str, command: str) -> tuple[str, bool]:
    host = FLEET_HOSTS.get(machine)
    if machine not in FLEET_HOSTS:
        return f"Unknown machine: {machine}", True
    argv = (["bash", "-lc", command] if host is None
            else ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, command])
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return f"[{machine}] timed out after 120s", True
    except Exception as e:  # noqa: BLE001
        return f"[{machine}] exec error: {e}", True
    out = ((proc.stdout or "") + (proc.stderr or "")).strip()
    return (out or "(no output)", proc.returncode != 0)


# ============================ session driver ================================
def _emit(q, kind, **data):
    q.put({"kind": kind, **data})


def drive_session(session_id, prompt, q):
    try:
        stream = client.beta.sessions.events.stream(session_id=session_id)
        client.beta.sessions.events.send(
            session_id=session_id,
            events=[{"type": "user.message", "content": [{"type": "text", "text": prompt}]}],
        )
        for event in stream:
            t = getattr(event, "type", "")
            if t == "agent.message":
                text = "".join(b.text for b in event.content if getattr(b, "type", "") == "text")
                if text:
                    _emit(q, "text", text=text)
            elif t == "agent.thinking":
                _emit(q, "status", text="thinking…")
            elif t in ("agent.tool_use", "agent.mcp_tool_use"):
                _emit(q, "tool", name=getattr(event, "name", "tool"))
            elif t == "agent.custom_tool_use" and getattr(event, "name", "") == "fleet_exec":
                m, cmd = event.input.get("machine"), event.input.get("command")
                _emit(q, "fleet", machine=m, command=cmd)
                output, is_error = run_fleet_command(m, cmd)
                _emit(q, "fleet_result", machine=m, output=output, error=is_error)
                client.beta.sessions.events.send(
                    session_id=session_id,
                    events=[{"type": "user.custom_tool_result", "custom_tool_use_id": event.id,
                             "content": [{"type": "text", "text": output}], "is_error": is_error}],
                )
            elif t == "session.error":
                _emit(q, "error", text=str(getattr(event, "error", event)))
            elif t == "session.status_terminated":
                _emit(q, "done", reason="terminated"); return
            elif t == "session.status_idle":
                sr = getattr(event, "stop_reason", None)
                if not sr or getattr(sr, "type", "") != "requires_action":
                    _emit(q, "done", reason="idle"); return
    except Exception as e:  # noqa: BLE001
        _emit(q, "error", text=f"{e}\n{traceback.format_exc()}")
        _emit(q, "done", reason="error")


# ============================ helpers =======================================
def dump(obj):
    """SDK pydantic model -> plain dict."""
    if hasattr(obj, "model_dump"):
        return obj.model_dump(exclude_none=True)
    return obj


def agent_config(a) -> dict:
    d = dump(a)
    return {k: d.get(k) for k in
            ("id", "name", "model", "system", "tools", "mcp_servers", "skills", "version", "description")
            if d.get(k) is not None}


def safe_path(rel: str) -> Path | None:
    """Resolve a 'root/relpath' string to an absolute path inside an allowed root."""
    if "/" not in rel:
        return None
    root_key, _, sub = rel.partition("/")
    root = FS_ROOTS.get(root_key)
    if not root:
        return None
    p = (root / sub).resolve()
    if root not in p.parents and p != root:
        return None
    return p


# ============================ HTTP ==========================================
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

    # ---------------- GET ----------------
    def do_GET(self):
        u = urlparse(self.path)
        p, qs = u.path, parse_qs(u.query)
        if p in ("/", "/index.html"):
            self._serve_html()
        elif p == "/api/targets":
            self._targets()
        elif p == "/api/agent":
            self._get_agent(qs.get("id", [""])[0], "yaml" in qs)
        elif p == "/api/env":
            self._get_env(qs.get("id", [""])[0])
        elif p == "/api/fs/list":
            self._fs_list()
        elif p == "/api/fs/read":
            self._fs_read(qs.get("path", [""])[0])
        elif p.startswith("/api/stream/"):
            self._stream(p.rsplit("/", 1)[-1])
        else:
            self._json({"error": "not found"}, 404)

    # ---------------- POST ----------------
    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/api/dispatch":
            self._dispatch(self._body())
        elif u.path == "/api/agent/save":
            self._save_agent(self._body())
        elif u.path == "/api/env/save":
            self._save_env(self._body())
        elif u.path == "/api/fs/write":
            self._fs_write(self._body())
        else:
            self._json({"error": "not found"}, 404)

    # ---------------- handlers ----------------
    def _serve_html(self):
        html = (HERE / "static" / "index.html").read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(html)))
        self.end_headers()
        self.wfile.write(html)

    def _targets(self):
        try:
            agents = [{"id": a.id, "name": a.name} for a in client.beta.agents.list()]
            envs = [{"id": e.id, "name": e.name, "type": getattr(e.config, "type", "?")}
                    for e in client.beta.environments.list()]
            vaults = [{"id": v.id, "name": getattr(v, "name", v.id)} for v in client.beta.vaults.list()]
            self._json({"agents": agents, "environments": envs, "vaults": vaults,
                        "fleet": list(FLEET_HOSTS.keys())})
        except Exception as e:  # noqa: BLE001
            self._json({"error": str(e)}, 500)

    def _get_agent(self, aid, as_yaml):
        if not aid:
            return self._json({"error": "id required"}, 400)
        try:
            cfg = agent_config(client.beta.agents.retrieve(aid))
            if as_yaml:
                editable = {k: cfg[k] for k in cfg if k not in ("id", "version")}
                return self._json({"id": aid, "version": cfg.get("version"),
                                   "yaml": yaml.safe_dump(editable, sort_keys=False, width=100)})
            self._json(cfg)
        except Exception as e:  # noqa: BLE001
            self._json({"error": str(e)}, 500)

    def _save_agent(self, body):
        try:
            if "yaml" in body:
                fields = yaml.safe_load(body["yaml"]) or {}
            else:
                fields = {k: body[k] for k in
                          ("name", "model", "system", "tools", "mcp_servers", "skills", "description")
                          if body.get(k) not in (None, "")}
            aid = body.get("id")
            if aid:
                a = client.beta.agents.update(aid, **fields)
                action = "updated"
            else:
                a = client.beta.agents.create(**fields)
                action = "created"
            self._json({"ok": True, "action": action, "id": a.id, "version": getattr(a, "version", None)})
        except Exception as e:  # noqa: BLE001
            self._json({"error": str(e)}, 400)

    def _get_env(self, eid):
        if not eid:
            return self._json({"error": "id required"}, 400)
        try:
            self._json(dump(client.beta.environments.retrieve(eid)))
        except Exception as e:  # noqa: BLE001
            self._json({"error": str(e)}, 500)

    def _save_env(self, body):
        try:
            name = body["name"]
            etype = body.get("type", "cloud")
            if etype == "self_hosted":
                config = {"type": "self_hosted"}
            else:
                net = body.get("networking", "unrestricted")
                config = {"type": "cloud", "networking": {"type": net}}
            e = client.beta.environments.create(name=name, config=config)
            self._json({"ok": True, "id": e.id, "name": e.name})
        except Exception as ex:  # noqa: BLE001
            self._json({"error": str(ex)}, 400)

    def _fs_list(self):
        out = []
        for key, root in FS_ROOTS.items():
            if not root.exists():
                continue
            for p in sorted(root.rglob("*")):
                if p.is_file() and p.suffix in FS_EXTS and ".venv" not in p.parts \
                        and "node_modules" not in p.parts:
                    try:
                        rel = f"{key}/{p.relative_to(root)}"
                        out.append({"path": rel, "size": p.stat().st_size})
                    except Exception:  # noqa: BLE001
                        pass
        self._json({"files": out, "roots": list(FS_ROOTS.keys())})

    def _fs_read(self, rel):
        p = safe_path(rel)
        if not p:
            return self._json({"error": "path not allowed"}, 403)
        if not p.exists():
            return self._json({"path": rel, "content": "", "exists": False})
        if p.suffix not in FS_EXTS:
            return self._json({"error": "extension not allowed"}, 403)
        try:
            self._json({"path": rel, "content": p.read_text(errors="replace"), "exists": True})
        except Exception as e:  # noqa: BLE001
            self._json({"error": str(e)}, 500)

    def _fs_write(self, body):
        rel, content = body.get("path", ""), body.get("content", "")
        p = safe_path(rel)
        if not p or p.suffix not in FS_EXTS:
            return self._json({"error": "path/extension not allowed"}, 403)
        # validate structured formats before saving
        if p.suffix == ".json":
            try:
                json.loads(content)
            except Exception as e:  # noqa: BLE001
                return self._json({"error": f"invalid JSON: {e}"}, 400)
        if p.suffix in (".yaml", ".yml"):
            try:
                yaml.safe_load(content)
            except Exception as e:  # noqa: BLE001
                return self._json({"error": f"invalid YAML: {e}"}, 400)
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content)
            self._json({"ok": True, "path": rel, "bytes": len(content)})
        except Exception as e:  # noqa: BLE001
            self._json({"error": str(e)}, 500)

    def _dispatch(self, body):
        agent_id = body.get("agent_id")
        env_id = body.get("environment_id")
        prompt = (body.get("prompt") or "").strip()
        vault_id = body.get("vault_id") or None
        if not (agent_id and env_id and prompt):
            return self._json({"error": "agent_id, environment_id, prompt required"}, 400)
        try:
            kwargs = {"agent": agent_id, "environment_id": env_id, "title": "Dispatch UI"}
            if vault_id:
                kwargs["vault_ids"] = [vault_id]
            session = client.beta.sessions.create(**kwargs)
        except Exception as e:  # noqa: BLE001
            return self._json({"error": f"create session: {e}"}, 500)
        q = queue.Queue()
        th = threading.Thread(target=drive_session, args=(session.id, prompt, q), daemon=True)
        with LOCK:
            SESSIONS[session.id] = {"q": q, "thread": th}
        th.start()
        ws = os.environ.get("ANTHROPIC_WORKSPACE", "default")
        self._json({"session_id": session.id,
                    "console": f"https://platform.claude.com/workspaces/{ws}/sessions/{session.id}"})

    def _stream(self, session_id):
        with LOCK:
            entry = SESSIONS.get(session_id)
        if not entry:
            return self._json({"error": "unknown session"}, 404)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        q = entry["q"]
        while True:
            try:
                msg = q.get(timeout=20)
            except queue.Empty:
                try:
                    self.wfile.write(b": keepalive\n\n"); self.wfile.flush(); continue
                except (BrokenPipeError, ConnectionResetError):
                    return
            try:
                self.wfile.write(f"data: {json.dumps(msg)}\n\n".encode()); self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return
            if msg.get("kind") == "done":
                return


def main():
    print(f"Fleet Dispatcher UI → http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
