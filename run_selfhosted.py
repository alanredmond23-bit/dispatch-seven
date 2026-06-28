"""RUNTIME — Path A, part 2: the driver (run anywhere with your API key).

Creates a session on the self_hosted environment and streams the result. The agent's
tool calls are executed by worker_selfhosted.py running on WORKHORSE — so the agent's own
`bash` does the fleet control (`ssh admin.local ...`); there is no fleet_exec tool here.

The worker MUST be running first (python worker_selfhosted.py).

Run:  python run_selfhosted.py "ssh into ADMIN and QUICKS, report free disk and uptime"
"""
from __future__ import annotations
import sys
import anthropic
from common import console_url, env

client = anthropic.Anthropic()  # ANTHROPIC_API_KEY (control plane)


def drive(prompt: str) -> None:
    session = client.beta.sessions.create(
        agent=env("AGENT_SELFHOSTED_ID"),
        environment_id=env("SELFHOSTED_ENV_ID"),
        vault_ids=[v] if (v := env("GITHUB_VAULT_ID", required=False)) else [],
        title="Fleet Dispatch (self-hosted)",
    )
    print(f"Watch in Console: {console_url(session.id)}\n")

    stream = client.beta.sessions.events.stream(session_id=session.id)
    client.beta.sessions.events.send(
        session_id=session.id,
        events=[{"type": "user.message", "content": [{"type": "text", "text": prompt}]}],
    )

    for event in stream:
        if event.type == "agent.message":
            for block in event.content:
                if block.type == "text":
                    print(block.text, end="", flush=True)
        elif event.type == "agent.tool_use":
            print(f"\n[tool] {event.name}", flush=True)
        elif event.type == "session.error":
            print(f"\n[error] {getattr(event, 'error', event)}", flush=True)
        elif event.type == "session.status_terminated":
            print("\n--- terminated ---")
            break
        elif event.type == "session.status_idle":
            if event.stop_reason.type != "requires_action":
                print("\n--- done ---")
                break


if __name__ == "__main__":
    drive(" ".join(sys.argv[1:]) or "Report uptime and free disk on WORKHORSE, ADMIN, and QUICKS.")
