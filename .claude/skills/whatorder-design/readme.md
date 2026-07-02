# WhatOrder Design System

The design system for **WhatOrder** — a WhatsApp-based order management platform for
small restaurants, döner shops, pizzerias and cafés in **Vienna, Austria** (currently in
pilot). Customers order through WhatsApp, the app they already have open; owners see and
manage every order from a web dashboard. No customer app to install, no POS terminal.

This system captures the two real surfaces WhatOrder ships:

1. **Marketing site** (`whatorder.at`) — a **dark**, high-contrast landing page. Green accent,
   big tracked-in display type, bordered cards on near-black.
2. **Owner Dashboard** (React web app) — a **light**, dense operational UI. White surfaces,
   gray hairlines, black primary buttons, and a rich order-status color system.

Both surfaces share one typeface (Inter) and one accent (green `#22C55E`). The system is
bilingual-by-design: the product ships **German (default), Turkish, and English** — copy is
authored in all three.

---

## Sources

Built by reading the attached codebase (read-only, mounted locally). Nothing here is invented;
values are copied verbatim from source.

- `WhatOrder/whatorderat/public/index.html` — marketing site (whatorder.at), all brand CSS + tri-lingual copy.
- `WhatOrder/whatorder-app/dashboard/` — React + Vite + TS owner dashboard.
  - `src/components/BrandLogo.tsx` — the logo lockup.
  - `src/pages/OrdersPage.tsx`, `OrderDetailPage.tsx`, `LoginPage.tsx`, `MenuPage.tsx`, etc. — inline-styled screens (source of all dashboard tokens).
  - `src/locales/{de,en,tr}.json` — full UI copy in three languages.
- `WhatOrder/whatorder-app/dashboard/public/assets/`, `WhatOrder/whatorderat/public/assets/` — logo SVGs, favicon.

> The dashboard's `src/index.css` is **Vite starter boilerplate** (purple `#646cff`, dark scaffold) and is **not** the real design — it is overridden by inline styles on every page. The tokens here come from the actual page/component code, not that file.

---

## Content fundamentals

**Voice.** Plain, direct, reassuring — talks to a busy shop owner, not a procurement team.
Second person, informal: German uses **"du"** (`Dein Restaurant`, `Trag dich ein`), English uses
**"you"**. Never corporate. The recurring promise is *less friction*: "no new app", "no chaos",
"no expensive POS". Sentences are short. Contractions are fine.

**Positioning line.** *"Ordering should be a conversation, not a chore."* The hero pairs a
possessive noun with an emphasized phrase: *"Your restaurant, in **every conversation.**"* — the
emphasized clause is the only gradient text on the page.

**Casing.** Sentence case everywhere for headings and buttons (`Get early access`, `Send request`).
UPPERCASE is reserved for tiny eyebrow labels and the pilot badge, always with wide tracking
(`HOW IT WORKS`, `PILOT · VIENNA, AUSTRIA`). Order statuses are Title/sentence case (`Ready for pickup`,
`Out for delivery`).

**Product nouns.** "Dashboard", "orders", "menu", "customizations", "WhatsApp line". The company
is written **WhatOrder** (one word, capital O), often with ® in the footer. The dashboard tags
itself "Owner dashboard".

**Numbers & money.** Euros with the symbol first and two decimals: `€24.50`, `+ €2.00 delivery fee`.
Dates render in Austrian format (`de-AT`, `DD.MM.YY, HH:MM`). Phone numbers `+43 660 123 4567`.

**Emoji.** Used *sparingly and functionally* in the app — 🚚 marks a delivery address/row, 🔒 marks
a closed day. Never decorative, never in marketing copy. Do not add emoji that aren't already
part of a functional label.

**Examples (verbatim).**
- Hero: "Customers order through WhatsApp — the app they already have open. No new app for you, no chaos in the chat list."
- Who: "For the neighbourhood spot — not corporate IT departments."
- Quote: "My customers are already on WhatsApp. Now they order from me directly — no app download."
- Dashboard empty state: "No orders yet." · Login tagline: "Owner dashboard".

---

## Visual foundations

**Two surfaces, one accent.** Green `#22C55E` is the single brand color and appears on both the
dark marketing site and the light dashboard. Everything else is neutral.

**Color.**
- *Marketing (dark):* page `#0A0A0A`, raised `#111111`, borders `#1E1E1E`, text `#E8E8E8`, muted `#666`. Accent green with a 12%-alpha wash (`rgba(34,197,94,.12)`) for badge fills.
- *Dashboard (light):* white surfaces, app bg `#FAFAFA`, borders `#EEE`/`#E5E7EB`/`#DDD`, text black/`#213547`, muted `#666`/`#999`.
- *Status system (the dashboard's signature):* each order status maps to a hue — pending `#F59E0B` (amber), approved `#A855F7` (purple), preparing `#F97316` (orange), ready `#3B82F6` (blue), on-the-way `#06B6D4` (cyan), delivered/picked-up/completed `#22C55E` (green), rejected `#EF4444` (red), cancelled `#6B7280` (gray). Badges render the hue at full strength on the same hue at ~13% alpha. Delivery accent is `#0EA5E9`.

**Type.** Inter, everywhere. Weights 300–700. Display headings use bold weight with heavy
negative tracking (`-0.04em`) and tight line-height (1.1); the hero uses fluid `clamp()` sizing.
Subtitles are light (300). The dashboard uses a dense rem scale (0.72–1.35rem). IDs, phone numbers,
and codes are set in a **monospace** stack.

**Backgrounds.** Flat color — no photography, no illustration, no textures, no repeating patterns.
The single gradient use is a 135° green→deep-green (`#22C55E → #059669`) on the logo mark and on
emphasized hero words (as text clip). A subtle radial green glow (`drop-shadow`) sits behind the
hero logo. Section dividers are a horizontal hairline that fades at both ends.

**Cards & surfaces.** Radius 12px for cards, 8px for inputs/buttons, 6px for compact controls,
10px for dialogs, 999px for pills. Dark cards: hairline `#1E1E1E` border, no shadow, border
brightens to `#333` on hover. Light cards: soft shadow `0 1px 4px rgba(0,0,0,.08)`, `#EEE` border.

**Borders & shadows.** Restrained. Hairline borders do most of the structural work. Shadows appear
only on the login card (soft), the confirm dialog (`0 12px 32px rgba(0,0,0,.25)`), and the mobile
nav drawer. On dark, elevation is expressed with borders, not shadows.

**Motion.** Quiet. Transitions are `0.2s`–`0.25s` ease on `background`, `border-color`, `transform`,
`filter`. The only looping animation is the pilot badge's dot pulse (2s opacity). The accent button
lifts `translateY(-1px)` on hover. No bounces, no springs, no scroll-jacking. `scroll-behavior: smooth`.

**Interaction states.** Hover: accent buttons darken (`#16A34A`) + lift; ghost buttons brighten
their border; nav links go from `#666` to near-black + weight 600 when active. Focus: inputs tint
the border green (light) or `rgba(34,197,94,.5)` (dark), native outline suppressed. Disabled:
opacity 0.6, cursor default. The sticky nav uses `backdrop-filter: blur(12px)` over an 85%-opaque bar.

**Layout.** Marketing content maxes at 1100px, centered, with generous 7rem section padding.
Dashboard is a fixed 200px left sidebar + fluid main, collapsing to a hamburger drawer under 640px.

**Imagery vibe.** There is essentially no photography in the product. When needed, imagery should
feel warm, local, and unglamorous (a real neighbourhood shop) — but the brand's default is
type-and-color, not pictures.

---

## Iconography

WhatOrder has **no icon library and no custom icon set**. This is intentional and should be preserved:

- **Emoji as functional glyphs:** 🚚 (delivery), 🔒 (closed day), plus UI affordances ☰ (menu), ✕ (close), ▼ (select chevron), ← (back). Used only where they carry meaning.
- **The only real vector artwork is the logo mark** — a rounded-square tile holding three
  descending "menu lines" and a check, in the green gradient. Reproduced in this system's
  `BrandLogo` component (SVG paths copied verbatim from the source asset) and in `assets/`.
- **No** Lucide/Heroicons/Font Awesome, no icon font, no PNG icon sprites anywhere in the codebase.

**Guidance for new work:** don't introduce a general icon set — it isn't part of the brand. If a
glyph is genuinely required, prefer a single emoji that already carries meaning, or a hairline
SVG drawn to match the logo's 2.5px round-cap stroke. Never hand-draw a facsimile of the logo;
use the `BrandLogo` component or the SVGs in `assets/`.

**Assets present** (`assets/`): `logo-mark.svg` (gradient tile), `logo-mark-flat.svg` (flat green,
for light UI), `logo-wordmark.svg` (mark + "WhatOrder" text), `favicon.svg`. The marketing repo's
PNG exports (og-image, whatsapp-profile) are build-generated and were not present to copy.

---

## Components

Reusable React primitives, drawn from the recurring patterns in the source (the dashboard is
inline-styled, so these codify what the code repeats). Import from `window.WhatOrderDesignSystem_b54bed`.

- **BrandLogo** (`components/brand/`) — mark + wordmark lockup; light/dark, sizes, optional glow.
- **Button** (`components/buttons/`) — `primary` (black), `accent` (green), `ghost`, `danger`; `tone` prop for status-colored action buttons; sizes; `fullWidth`.
- **StatusBadge** (`components/feedback/`) — order-status pill in lifecycle hue on translucent fill.
- **PaymentBadge** (`components/feedback/`) — cash/paid/unpaid/failed payment pill.
- **Badge** (`components/feedback/`) — marketing eyebrow pill with pulsing dot.
- **Tag** (`components/feedback/`) — neutral category chip (dark surface).
- **Input** (`components/forms/`) — text input, `light`/`dark` surface, focus-tinted border, optional label.
- **Select** (`components/forms/`) — compact dashboard dropdown with custom chevron.
- **Card** (`components/surfaces/`) — container; `light` (soft shadow) or `dark` (hairline, hover brighten).
- **StepCard** (`components/marketing/`) — numbered feature card for "how it works".
- **QuoteBlock** (`components/marketing/`) — testimonial panel.
- **SectionLabel** (`components/marketing/`) — green uppercase section eyebrow.

*Intentional additions:* `SectionLabel`, `StepCard`, and `QuoteBlock` are extracted from the marketing
page's repeated markup (they aren't named components in source but recur verbatim). `PaymentBadge` and
`StatusBadge` codify the two badge patterns the dashboard repeats across pages.

---

## UI kits

Full-screen, click-through recreations composed from the components above.

- **`ui_kits/dashboard/`** — the light owner dashboard: Orders list, Order detail with lifecycle actions, Menu, and phone login. `index.html` is an interactive click-through.
- **`ui_kits/marketing/`** — the dark `whatorder.at` landing page recreation (hero, how-it-works, who-it's-for, access CTA, footer).

---

## Foundations (Design System tab)

Specimen cards live in `guidelines/` and are grouped in the Design System tab:
**Colors** (brand green, dark neutrals, light neutrals, order-status hues), **Type** (display, UI
scale, weights & mono), **Spacing** (scale, radius & shadow), **Brand** (logo & mark).

---

## Index / manifest

- `styles.css` — global entry point (imports only). **Consumers link this.**
- `tokens/` — `colors.css`, `status.css`, `typography.css`, `spacing.css`, `fonts.css`.
- `components/` — `brand/`, `buttons/`, `feedback/`, `forms/`, `surfaces/`, `marketing/` (each: `.jsx` + `.d.ts` + `.prompt.md` + a `@dsCard` HTML).
- `guidelines/` — foundation specimen cards.
- `ui_kits/dashboard/`, `ui_kits/marketing/` — product recreations.
- `assets/` — logo SVGs + favicon.
- `SKILL.md` — Agent-Skills-compatible entry point.

## Substitutions / caveats

- **Inter** is loaded from Google Fonts (the genuine brand font, used in both surfaces in source) — this is not a substitution, but it does require network access; no local font binaries were shipped in the source to vendor.
- Marketing PNG exports (og-image, WhatsApp profile) were build-generated and absent from the source tree, so only the SVG logo assets were copied.
