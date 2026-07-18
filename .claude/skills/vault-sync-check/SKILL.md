---
name: vault-sync-check
description: >-
  Check whatorder-app commits against vault docs for drift. Manual ritual only —
  invoke when the user says vault sync check, sync check, freshness check, or babysit the vault.
disable-model-invocation: true
---

When invoked, follow the prompt at:
`../../../../whatorder-vault/Skills/vault-sync-check/prompt.md`

That file is loaded via vault `CLAUDE.md` (through `.claude/CLAUDE.local.md`). Execute its workflow directly.
