# Agent Evals

- **Run:** `npm run eval`
- **Add a new eval:** copy an existing `.yaml`, add tests, set threshold
- **CI gate:** PRs touching `agents/` must pass all evals at threshold
- Orchestrator threshold: 0.75 | Legal: 0.80 | Build: 0.75
- Provider: anthropic:claude-sonnet-4-5 (requires ANTHROPIC_API_KEY)
