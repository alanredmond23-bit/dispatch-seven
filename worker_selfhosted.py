"""RUNTIME — Path A, part 1: the worker (run this ON WORKHORSE, keep it running).

This polls Anthropic's work queue (outbound-only) and executes the agent's tool calls
ON THIS MACHINE. Because WORKHORSE is on your Tailnet, the agent's `bash` can ssh into
ADMIN/QUICKS directly — that's the whole point of the self-hosted path.

Prereqs on WORKHORSE: /bin/bash present (it is, on macOS), your ~/.ssh/config set up for
admin.local / quicks.local, and ANTHROPIC_ENVIRONMENT_KEY in .env (Console -> the
self_hosted environment -> "Generate environment key").

Start:  python worker_selfhosted.py     (leave it running; Ctrl-C to stop)
"""
from __future__ import annotations
import asyncio
import os
from anthropic import AsyncAnthropic
from anthropic.lib.environments import EnvironmentWorker
from common import env

WORKDIR = os.path.expanduser("~/Desktop/fleet-dispatcher/workspace")


async def main() -> None:
    os.makedirs(WORKDIR, exist_ok=True)
    key = env("ANTHROPIC_ENVIRONMENT_KEY")
    env_id = env("SELFHOSTED_ENV_ID")
    # The worker authenticates with the ENVIRONMENT key (not your org API key).
    async with AsyncAnthropic(auth_token=key) as client:
        print(f"Worker up. Executing fleet/tool calls in {WORKDIR}. Ctrl-C to stop.")
        await EnvironmentWorker(
            client,
            environment_id=env_id,
            environment_key=key,
            workdir=WORKDIR,
        ).run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nWorker stopped.")
