# WhatsApp real E2E (`e2e-wa`)

Automates customer ↔ Test business WhatsApp against **real** Meta Cloud API. No mocks of bot, Firestore, or outbound sends.

**Spec (SSOT):** `whatorder-vault/Projects/WhatOrder/specs/feature-whatsapp-e2e-automation.md`  
**Plan:** `whatorder-vault/Projects/WhatOrder/notes/plan-2026-07-25-whatsapp-e2e-automation.md`

## Status

Runner + scenarios implemented. Customer phone **verified 2026-07-26** (`+43 660 2585284` / id `1289261107598515`).  
**Next:** `E2E_WA_CUSTOMER_ACCESS_TOKEN` + customer webhook (Asana `1216870799462735`).

## Offline tests

```bash
cd backend
npm test -- --testPathPatterns=e2e-wa
```

## Live run

1. Set `E2E_WA_CUSTOMER_ACCESS_TOKEN` in `.env.local` (see vault **After verification succeeds**).
2. Terminal A: `npm run e2e:wa:reply-server` → ngrok → Meta customer Callback `…/webhooks/customer`.
3. Terminal B:

```bash
npm run e2e:wa -- --list
npm run e2e:wa -- --all-pack-a          # happy + owner (default)
npm run e2e:wa -- --scenario neg_cancel
npm run e2e:wa -- --all-pack-b
```

**Hard rule:** business phone number id must be Test `1056173694256337`. Runner aborts on prod id.
