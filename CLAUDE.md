# D7 — Dispatch Seven | CLAUDE.md
# Global context for Claude Code CLI on WORKHORSE (stripe_secure)

## PROJECT
D7 is a 12-agent parallel AI operating system.
- Frontend: Vite 5 + React 18 + TypeScript + Tailwind 4 → Netlify
- Backend: Hono 4 TypeScript → Azure Container Apps (menagerie-rg)
- DB: Supabase pgvector (fifybuzwfaegloijrmqb), schema: dispatch7
- Embeddings: Voyage AI voyage-3
- Secrets: Azure Key Vault menagerie-kv-37040 (never hardcode)
- AI Gateway: LiteLLM (3 Anthropic keys, load-balanced)

## 12 AGENTS
ORCHESTRATOR | LEGAL | DISCOVERY | FINANCE | BUILD | QA
RESEARCH | COMMS | MEMORY | MONITOR | SCHEDULER | EXECUTE

## RULES
- Secrets via Key Vault only — never in code or .env commits
- All agent comms via shared dispatch7.tasks table (Supabase)
- 5th Amendment reservation on any legal output
- REBER RULE: never name Jeff Reber in any filing
- RUSH-SCHMEHL: never mention Rush's clerkship in any filing

## ACTIVE CASE
5:24-cr-00376 | Judge Schmehl | Trial 2026-09-14
Bates prefix: REDMOND-TAX | Discovery: ~6TB Five9 WAVs

## KEY CONTACTS
- ECRO: Kenneth Duvak (good rapport)
- Chambers: Chambers_of_Judge_Jeffrey_L_Schmehl@paed.uscourts.gov
- Kraft filings: 484-663-4433 + alanredmond23@gmail.com by 5PM
