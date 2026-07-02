---
name: whatorder-design
description: Use this skill to generate well-branded interfaces and assets for WhatOrder, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick orientation
- **WhatOrder** = WhatsApp-based order management for small Vienna restaurants. Two surfaces: a **dark** marketing site and a **light** owner dashboard. One font (Inter), one accent (green `#22C55E`).
- `styles.css` — link this; it imports all tokens (`tokens/`).
- `components/` — React primitives (BrandLogo, Button, StatusBadge, PaymentBadge, Badge, Tag, Input, Select, Card, StepCard, QuoteBlock, SectionLabel).
- `ui_kits/dashboard/`, `ui_kits/marketing/` — full-screen recreations to copy from.
- `assets/` — logo SVGs + favicon.
- The dashboard's **order-status color system** is the signature — see `tokens/status.css` and README "Visual foundations".
