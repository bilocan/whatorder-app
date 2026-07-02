WhatOrder's button. Use `primary` (black) inside the dashboard, `accent` (green) for marketing CTAs, `ghost` for secondary actions on dark, and `danger` for destructive ones. For order-lifecycle buttons, pass a status color via `tone`.

```jsx
<Button variant="accent">Get early access</Button>
<Button variant="primary">Approve</Button>
<Button tone="var(--status-preparing)">Start Preparation</Button>
<Button variant="ghost">See how it works</Button>
<Button variant="danger" size="sm">Reject</Button>
```

- `fullWidth` for form submits (login, access request).
- Only `accent` lifts on hover; all fade on `disabled`.
