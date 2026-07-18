---
name: whatorder-responsive-qa
description: >-
  Responsive and visual QA for WhatOrder at 375–1280px (dashboard drawer at 640px).
  Use automatically after editing dashboard UI/CSS/layout under dashboard/src/**;
  also when the user says responsive qa, mobile check, or visual qa.
paths:
  - "dashboard/src/**/*.tsx"
  - "dashboard/src/**/*.css"
  - "dashboard/src/components/**"
  - "dashboard/src/pages/**"
---

When invoked, follow the prompt at:
`../../../../whatorder-vault/Skills/whatorder-responsive-qa/prompt.md`

That file is loaded via vault `CLAUDE.md` (through `.claude/CLAUDE.local.md`). Execute its workflow directly.
