Feedback pills. `StatusBadge` and `PaymentBadge` are the dashboard's translucent-fill status pills; `Badge` is the marketing eyebrow with a pulsing dot; `Tag` is a neutral category chip.

```jsx
<StatusBadge status="preparing" />
<StatusBadge status="on_the_way" />
<PaymentBadge kind="paid" />
<Badge>Pilot · Vienna, Austria</Badge>
<Tag>Döner &amp; Kebab</Tag>
```

- `StatusBadge`/`PaymentBadge` auto-label in English; pass `label` for other languages.
- `Badge` and `Tag` are for the dark marketing surface.
