# Owner Dashboard — UI kit

Interactive, click-through recreation of the WhatOrder **light** owner dashboard.

**Flow:** phone login (any code advances) → Orders list → click a row for Order detail →
advance the order through its lifecycle with the status-colored action buttons. The **Menu**
nav item shows the item list with availability toggles. Other nav items are placeholders.

**Files**
- `index.html` — app shell + routing state; loads the design-system bundle.
- `data.js` — fake orders + menu.
- `Sidebar.jsx` — nav + presence panel (composes `BrandLogo`).
- `LoginScreen.jsx` — phone OTP login (composes `Card`, `Input`, `Button`).
- `OrdersScreen.jsx` — legacy orders table kit (composes `StatusBadge`, `PaymentBadge`, `Select`).
- `OrderDetailScreen.jsx` — detail + lifecycle actions (composes `Button` with `tone`).
- `MenuScreen.jsx` — menu by category with availability toggles.
- `Dashboard-Improvements.dc.html` — Claude Design exploration:
  - **Settings:** **3a** sectioned cards (profile, hours, delivery/payment, language) — production chose 3a
  - **Menu:** 2a category accordion vs 2b flat table (production chose 2a)
  - **Orders:** 1a priority list vs **1b kitchen board** (production chose 1b)
  - Mock “Notifications” toggles are exploration-only (not in production Settings)

Composes the shared primitives from `window.WhatOrderDesignSystem_b54bed`; it does not
re-implement them.
