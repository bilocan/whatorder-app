---
title: WhatOrder Design System
type: reference
tags: [whatorder, design, brand, frontend]
aliases: [Brand Guide, Design Tokens]
updated: 2026-07-02
---

# 🎨 WhatOrder Design System

> [!info] What this is
> The single source of truth for how WhatOrder **looks**. This note is the readable
> index — the working files (CSS tokens, React components, UI kits) live in the code repo.
> Point Cursor / Claude Code at those; read this for reference.

**Where the files live:** `whatorder-app/.claude/skills/whatorder-design/` (this folder) — vault readable index: `whatorder-vault/Resources/WhatOrder-Design-System.md`. How-to: `whatorder-vault/Resources/tools/whatorder-design-howto.md`.

WhatOrder has **two surfaces, one brand**: a **dark** marketing site (`whatorder.at`) and a
**light** owner dashboard. One typeface (Inter), one accent (green). Everything else is neutral.

---

## Brand cheat-sheet

### Accent — green (the only brand color)
| Token | Hex | Use |
|---|---|---|
| `--green-500` | `#22C55E` | primary accent |
| `--green-600` | `#16A34A` | hover / pressed |
| `--green-700` | `#059669` | gradient end |
| gradient | `#22C55E → #059669` | logo mark, hero emphasis text |

### Surfaces
- **Dark (marketing):** bg `#0A0A0A` · raised `#111111` · border `#1E1E1E` · text `#E8E8E8` · muted `#666`
- **Light (dashboard):** white surfaces · app bg `#FAFAFA` · borders `#EEE / #E5E7EB` · text `#000 / #213547`

### Order-status colors (the dashboard signature)
`pending #F59E0B` · `approved #A855F7` · `preparing #F97316` · `ready #3B82F6` ·
`on-the-way #06B6D4` · `delivered/completed #22C55E` · `rejected #EF4444` · `cancelled #6B7280`
Delivery accent: `#0EA5E9`. Badges = hue text on the same hue at ~13% alpha.

### Type
**Inter**, weights 300–700. Big headings: bold, tight tracking (`-0.04em`), line-height 1.1.
Subtitles: light (300). IDs / phone numbers / codes: **monospace**.

### Shape & feel
Radius: cards 12px · inputs/buttons 8px · controls 6px · pills 999px.
Motion is quiet (0.2s fades; accent button lifts 1px; badge dot pulses). Elevation on dark = borders, not shadows.

### Voice
Plain, direct, informal ("du" / "you"). Sells *less friction*: "no new app", "no chaos", "no expensive POS".
Sentence case; UPPERCASE only for tiny eyebrow labels. Tri-lingual: **DE (default) · TR · EN**.
Emoji only when functional (🚚 delivery, 🔒 closed).

> [!warning] Not the design
> The dashboard's `src/index.css` is Vite starter boilerplate (purple `#646cff`). Ignore it —
> the real styling is inline on each page, and that's what these tokens capture.

---

## What's in the system

- **`styles.css`** → imports all tokens in **`tokens/`** (`colors`, `status`, `typography`, `spacing`, `fonts`)
- **`components/`** — React primitives: BrandLogo, Button, StatusBadge, PaymentBadge, Badge, Tag, Input, Select, Card, StepCard, QuoteBlock, SectionLabel
- **`ui_kits/dashboard/`** — interactive light dashboard recreation (login → orders → lifecycle → menu)
- **`ui_kits/marketing/`** — dark landing-page recreation
- **`assets/`** — logo SVGs + favicon
- **`readme.md`** — the full guide · **`SKILL.md`** — Claude Code skill entry point

---

## Using it

- **In Cursor / Claude Code:** invoke `/whatorder-design` or say *"use the whatorder-design skill"* — files are in this folder (`readme.md`, `tokens/`, `components/`, `ui_kits/`).
- **Vault how-to:** `whatorder-vault/Resources/tools/whatorder-design-howto.md`
- **Claude Design (web):** [claude.ai/design](https://claude.ai/design) — see vault how-to for setup.

Related: [[Projects/WhatOrder/CLAUDE|WhatOrder engineering config]]
