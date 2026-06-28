"""ONE-TIME SETUP — run once, then save the printed IDs into .env.

Creates:
  - a cloud environment (path B)
  - a self_hosted environment (path A)
  - a GitHub MCP vault credential (if GITHUB_MCP_OAUTH_TOKEN is set)
  - agent_cloud      (built-in toolset + fleet_exec custom tool + GitHub MCP + skills)
  - agent_selfhosted (built-in toolset + GitHub MCP + skills; bash runs ON WORKHORSE)

Re-running creates NEW objects. Don't put this in a hot path — it's setup, not runtime.
Prefer running it from a clean shell so a stale ANTHROPIC_API_KEY doesn't route to the
wrong workspace.
"""
from __future__ import annotations
import json
import anthropic
from common import (
    MODEL, SKILLS, GITHUB_MCP, SYSTEM_PROMPT, FLEET_EXEC_TOOL, env,
)

client = anthropic.Anthropic()  # ANTHROPIC_API_KEY from env

TOOLSET = {"type": "agent_toolset_20260401", "default_config": {"enabled": True}}
GITHUB_TOOLSET = {"type": "mcp_toolset", "mcp_server_name": "github"}


def make_environments() -> tuple[str, str]:
    cloud = client.beta.environments.create(
        name="fleet-dispatcher-cloud",
        config={"type": "cloud", "networking": {"type": "unrestricted"}},
    )
    selfhosted = client.beta.environments.create(
        name="fleet-dispatcher-selfhosted",
        config={"type": "self_hosted"},
    )
    return cloud.id, selfhosted.id


def make_github_vault() -> str | None:
    token = env("GITHUB_MCP_OAUTH_TOKEN", required=False)
    if not token:
        print("  (skipping GitHub vault — GITHUB_MCP_OAUTH_TOKEN not set)")
        return None
    vault = client.beta.vaults.create(name="fleet-dispatcher-github")
    client.beta.vaults.credentials.create(
        vault.id,
        display_name="GitHub MCP",
        auth={
            "type": "mcp_oauth",
            "mcp_server_url": GITHUB_MCP["url"],
            "access_token": token,
            # If you have a refresh token, add a "refresh" block here so Anthropic
            # auto-refreshes; otherwise the credential works until it expires.
        },
    )
    return vault.id


def make_agents() -> tuple[str, str]:
    # B: cloud — bash runs in Anthropic's container (research/scratch); fleet via custom tool.
    agent_cloud = client.beta.agents.create(
        name="Fleet Dispatcher (cloud)",
        model=MODEL,
        system=SYSTEM_PROMPT,
        tools=[TOOLSET, FLEET_EXEC_TOOL, GITHUB_TOOLSET],
        mcp_servers=[GITHUB_MCP],
        skills=SKILLS,
    )
    # A: self-hosted — bash runs ON WORKHORSE, so the agent SSHes the fleet itself.
    agent_selfhosted = client.beta.agents.create(
        name="Fleet Dispatcher (self-hosted)",
        model=MODEL,
        system=SYSTEM_PROMPT,
        tools=[TOOLSET, GITHUB_TOOLSET],
        mcp_servers=[GITHUB_MCP],
        skills=SKILLS,
    )
    return agent_cloud.id, agent_selfhosted.id


def main() -> None:
    print("Creating environments...")
    cloud_env, selfhosted_env = make_environments()
    print("Creating GitHub vault...")
    vault_id = make_github_vault()
    print("Creating agents...")
    agent_cloud, agent_selfhosted = make_agents()

    ids = {
        "CLOUD_ENV_ID": cloud_env,
        "SELFHOSTED_ENV_ID": selfhosted_env,
        "AGENT_CLOUD_ID": agent_cloud,
        "AGENT_SELFHOSTED_ID": agent_selfhosted,
        "GITHUB_VAULT_ID": vault_id or "",
    }
    with open("fleet.ids.json", "w") as f:
        json.dump(ids, f, indent=2)

    print("\n=== Saved to fleet.ids.json. Paste these into .env: ===")
    for k, v in ids.items():
        print(f"{k}={v}")
    print(
        "\nPath A only: open the self_hosted environment in Console, click "
        "'Generate environment key', and put it in .env as ANTHROPIC_ENVIRONMENT_KEY."
    )


if __name__ == "__main__":
    main()
