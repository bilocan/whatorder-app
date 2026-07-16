---
name: whatorder-design
description: >-
  WhatOrder brand design system for owner dashboard and marketing UI. Use automatically
  when editing dashboard/src appearance (layout, CSS, pages, components, badges, buttons);
  also when the user asks for design, branded UI, mocks, or /whatorder-design.
  Contains tokens, status colors, type, assets, and UI kits. Accent #22C55E only —
  never indigo #6366f1 or Vite purple #646cff.
paths:
  - "dashboard/src/**/*.tsx"
  - "dashboard/src/**/*.css"
  - "dashboard/src/components/**"
  - "dashboard/src/pages/**"
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code (especially `dashboard/src/**`), read the rules here and apply tokens/patterns to React — do not invent indigo/purple Vite defaults (`#6366f1`, `#646cff`).
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## When to use (production)

- **Always** for visual changes under `dashboard/src/` (pages, Layout, badges, forms, spacing, colors).
- Path rule SSOT: vault `Projects/WhatOrder/ai-rules/dashboard.md` (Design section).
- Reference kit: `ui_kits/dashboard/` — light surface, black primary buttons, green accent, status-colored lifecycle actions.

## Quick orientation
- **WhatOrder** = WhatsApp-based order management for small Vienna restaurants. Two surfaces: a **dark** marketing site and a **light** owner dashboard. One font (Inter), one accent (green `#22C55E`).
- `styles.css` — link this; it imports all tokens (`tokens/`).
- `components/` — React primitives (BrandLogo, Button, StatusBadge, PaymentBadge, Badge, Tag, Input, Select, Card, StepCard, QuoteBlock, SectionLabel).
- `ui_kits/dashboard/`, `ui_kits/marketing/` — full-screen recreations to copy from.
- `assets/` — logo SVGs + favicon.
- The dashboard's **order-status color system** is the signature — see `tokens/status.css` and README "Visual foundations".
- Production dashboard uses brand green `#22C55E` for accent UI (links, selected chips, highlights). Do not reintroduce indigo (`#6366f1`) or Vite purple (`#646cff`).
