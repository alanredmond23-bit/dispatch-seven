"""RUNTIME — Path B: cloud sandbox + host-side fleet_exec.

The agent loop and bash/research run in Anthropic's cloud container. When the agent
wants to touch the fleet it calls the `fleet_exec` custom tool; THIS process (running on
WORKHORSE, on your Tailnet) executes the command and returns the result. Secrets and SSH
keys never leave WORKHORSE.

Run on WORKHORSE:  python run_cloud.py "Check disk usage on ADMIN and QUICKS"
"""
from __future__ import annotations
import subprocess
import sys
import anthropic
from common import FLEET_HOSTS, build_dispatched_prompt, console_url, env

client = anthropic.Anthropic()  # ANTHROPIC_API_KEY


def run_fleet_command(machine: str, command: str) -> tuple[str, bool]:
    """Execute on a fleet machine. WORKHORSE runs locally; others over ssh.
    Returns (combined_output, is_error)."""
    host = FLEET_HOSTS.get(machine)
    if machine not in FLEET_HOSTS:
        return f"Unknown machine: {machine}", True
    argv = ["bash", "-lc", command] if host is None else [
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, command
    ]
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return f"[{machine}] command timed out after 120s", True
    out = (proc.stdout or "") + (proc.stderr or "")
    return (out.strip() or "(no output)", proc.returncode != 0)


def drive(prompt: str) -> None:
    session = client.beta.sessions.create(
        agent=env("AGENT_CLOUD_ID"),
        environment_id=env("CLOUD_ENV_ID"),
        vault_ids=[v] if (v := env("GITHUB_VAULT_ID", required=False)) else [],
        title="Fleet Dispatch (cloud)",
    )
    print(f"Watch in Console: {console_url(session.id)}\n")

    # Inject live memory context into the first user message.
    # build_dispatched_prompt() reads priority memory files from WORKHORSE disk
    # and prepends them so the agent has current state from turn 1.
    full_prompt = build_dispatched_prompt(prompt)

    # Stream-first, then send the kickoff (so we don't miss early events).
    stream = client.beta.sessions.events.stream(session_id=session.id)
    client.beta.sessions.events.send(
        session_id=session.id,
        events=[{"type": "user.message", "content": [{"type": "text", "text": full_prompt}]}],
    )

    for event in stream:
        if event.type == "agent.message":
            for block in event.content:
                if block.type == "text":
                    print(block.text, end="", flush=True)

        elif event.type == "agent.custom_tool_use" and event.name == "fleet_exec":
            machine, command = event.input["machine"], event.input["command"]
            print(f"\n[fleet_exec] {machine}: {command}")
            output, is_error = run_fleet_command(machine, command)
            client.beta.sessions.events.send(
                session_id=session.id,
                events=[{
                    "type": "user.custom_tool_result",
                    "custom_tool_use_id": event.id,
                    "content": [{"type": "text", "text": output}],
                    "is_error": is_error,
                }],
            )

        elif event.type == "session.status_terminated":
            print("\n--- terminated ---")
            break

        elif event.type == "session.status_idle":
            # idle fires transiently (e.g. awaiting our tool result). Only stop when
            # the agent is genuinely done.
            if event.stop_reason.type != "requires_action":
                print("\n--- done ---")
                break


if __name__ == "__main__":
    drive(" ".join(sys.argv[1:]) or "Report uptime and disk usage on all three fleet machines.")
