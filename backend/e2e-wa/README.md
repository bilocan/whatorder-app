# WhatsApp real E2E (`e2e-wa`)

Automates customer ↔ Test business WhatsApp against **real** Meta Cloud API. No mocks of bot, Firestore, or outbound sends.

**Spec (SSOT):** `whatorder-vault/Projects/WhatOrder/specs/feature-whatsapp-e2e-automation.md`  
**Plan:** `whatorder-vault/Projects/WhatOrder/notes/plan-2026-07-25-whatsapp-e2e-automation.md`

## Status

Runner + scenarios implemented. Customer phone on app `WhatOrderE2E-Customer` **registered 2026-07-26** (`+43 660 2585284` / id `1176672252201658`).  
**Next:** `E2E_WA_CUSTOMER_ACCESS_TOKEN` + customer webhook (Asana `1216870799462735`).

## Offline tests

```bash
cd backend
npm test -- --testPathPatterns=e2e-wa
```

## Live run

```bash
# default target=test  (+43 681 20575797)
npm run e2e:wa -- --all-pack-a

# BenAT Test display from links-and-config
npm run e2e:wa -- --target test-benat --all-pack-a

# preprod smoke (same Meta id as prod — webhook must be pre only)
npm run e2e:wa -- --target preprod --all-pack-a

# prod only with explicit allow
E2E_WA_ALLOW_PROD=1 npm run e2e:wa -- --target prod --scenario happy_cash_pickup
```

Or set `E2E_WA_TARGET=test` in `.env.local`. Override display/id with `E2E_WA_BUSINESS_DISPLAY` / `E2E_WA_BUSINESS_PHONE_NUMBER_ID` if needed.

1. Set `E2E_WA_CUSTOMER_ACCESS_TOKEN` in `.env.local`.
2. Terminal A: `npm run e2e:wa:reply-server` → ngrok → Meta customer Callback `…/webhooks/customer`.
3. Terminal B: commands above.

**Hard rule:** business phone number id must be Test `1056173694256337`. Runner aborts on prod id.
