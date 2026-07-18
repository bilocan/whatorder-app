# Claude Code skills (app repo)

Thin pointers only. **Do not add Firebase, Xcode, or other generic skill packs here.**

| Skill | Vault SSOT |
|-------|------------|
| whats-next | `whatorder-vault/Skills/whats-next/prompt.md` |
| capture-idea | `whatorder-vault/Skills/capture-idea/prompt.md` |
| capture-bug | `whatorder-vault/Skills/capture-bug/prompt.md` |
| task-done | `whatorder-vault/Skills/task-done/prompt.md` |
| summarize | `whatorder-vault/Skills/summarize/prompt.md` |
| vault-sync-check | `whatorder-vault/Skills/vault-sync-check/prompt.md` |
| ai-radar-scan | `whatorder-vault/Skills/ai-radar-scan/prompt.md` |
| ai-radar-review | `whatorder-vault/Skills/ai-radar-review/prompt.md` |
| whatorder-copy | `whatorder-vault/Skills/whatorder-copy/prompt.md` |
| whatorder-responsive-qa | `whatorder-vault/Skills/whatorder-responsive-qa/prompt.md` |
| whatorder-pr-review | `whatorder-vault/Skills/whatorder-pr-review/prompt.md` |
| whatorder-design | `whatorder-app/.claude/skills/whatorder-design/` (product skill — files in repo, not vault prompt) |

Prompts load via `@../../whatorder-vault/CLAUDE.md` in `.claude/CLAUDE.local.md`.

To change workflow skill behavior, edit vault `Skills/{name}/prompt.md`. For design tokens and UI kits, edit `.claude/skills/whatorder-design/` and vault [[Resources/WhatOrder-Design-System]]. See `whatorder-vault/Projects/WhatOrder/specs/ai-config-architecture.md`.

Firebase stack reference: vault `Projects/WhatOrder/specs/technical-architecture.md` and `specs/deployment.md`.
