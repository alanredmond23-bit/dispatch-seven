# D7 — Dispatch Seven

**Personal AI Operating System**
12-Agent Parallel Swarm | Anthropic API Tier 4

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite 5 + React 18 + TypeScript + Tailwind 4 → Netlify |
| Backend | Hono 4 TypeScript → Azure Container Apps |
| Vector DB | Supabase pgvector (`fifybuzwfaegloijrmqb`) |
| Embeddings | Voyage AI `voyage-3` |
| Secrets | Azure Key Vault `menagerie-kv-37040` |
| AI Gateway | LiteLLM (self-hosted, routes all providers) |

## Status
🔴 Pre-build. Single P0 blocker: **Voyage AI API key**.

## 12-Agent Architecture

| # | Agent | Role |
|---|-------|------|
| 1 | ORCHESTRATOR | Master coordinator — routes tasks to all agents |
| 2 | LEGAL | Case monitoring, docket alerts, filing drafts |
| 3 | DISCOVERY | 6TB pipeline mgmt, Five9 WAV indexing |
| 4 | FINANCE | ABN + DPC ops, payment processing |
| 5 | BUILD | Code generation, repo management |
| 6 | QA | Test, audit, completeness checks |
| 7 | RESEARCH | Intel gathering, web search, analysis |
| 8 | COMMS | Drafting, messaging, correspondence |
| 9 | MEMORY | State management, context persistence |
| 10 | MONITOR | Infra health, Azure alerts |
| 11 | SCHEDULER | Deadlines, calendar, court dates |
| 12 | EXECUTE | Terminal ops, CLI execution |

## Pre-Build Checklist

- [ ] **P0** Voyage AI API key → Key Vault `menagerie-kv-37040`
- [ ] Supabase schema `dispatch7` initialized in `fifybuzwfaegloijrmqb`
- [ ] Azure Container Apps environment created in `menagerie-rg`
- [ ] Netlify project linked to this repo
- [ ] Anthropic Tier 4 confirmed active (3 keys available)
- [ ] LiteLLM gateway routing verified

## Cases Served (FED domain)
- **5:24-cr-00376** — US v. Redmond (trial 2026-09-14, Judge Schmehl, EDPA)
- **4:24-bk-13093** — Chapter 7, Judge Mayer
- **AP 25-00254** — Ready v. Redmond
- **AP 25-00119** — SBA adversary
- **25-13446** — Foreclosure, Judge Fudeman

---
*Built by Digital Principles Corp (EIN 87-1484306)*
