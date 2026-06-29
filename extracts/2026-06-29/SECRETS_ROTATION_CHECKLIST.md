# Secrets Rotation Checklist — 2026-06-29

## CRITICAL — Action Required

- [ ] Move CLOUD ENV CURATED.env off Workhorse Desktop to Key Vault or encrypted store
- [ ] Move CLOUD ENV FULL.env off Workhorse Desktop
- [ ] GitHub PAT (alanredmond23-bit org) appeared in JSONL transcript local_d1741784 — confirm exposure scope
- [ ] Codex access token cleared from OmniFocus before extraction — value unrecoverable; rotate if still in use

## Advisory

- [ ] Review all 367 keys in FINAL_EXPLODED_KEYS_v2.xlsx for last-rotated dates
- [ ] LITELLM proxy keys — retire after PR#8 merges (service becoming redundant)
- [ ] Azure Windows VM (claude-ws) — deallocate to stop $1.26/hr burn

## SECRETS_FOUND: 2 categories across 1 file
(Category: transcript-embedded PAT, Category: env-file-plaintext)
Values not reproduced in this output.
