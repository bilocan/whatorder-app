# WhatsApp real E2E (`e2e-wa`)

Automates customer ↔ Test business WhatsApp against the **real** Meta network. No mocks of bot, Firestore, or outbound sends.

**Spec (SSOT):** `whatorder-vault/Projects/WhatOrder/specs/feature-whatsapp-e2e-automation.md`  
**Plan:** `whatorder-vault/Projects/WhatOrder/notes/plan-2026-07-25-whatsapp-e2e-automation.md`

## Status

**Preferred customer transport:** WhatsApp Web + Playwright on Contabo (`E2E_WA_CUSTOMER_TRANSPORT=wa-web`). Dual Cloud API customer path is **deprecated** for pack A (bot → Cloud API customer undeliverable).

Contabo: `169.58.94.216` (see vault `links-and-config`).

## Offline tests

```bash
cd backend
npm test -- --testPathPatterns=e2e-wa
```

## Contabo live run (wa-web)

1. QR-link WhatsApp Web once in Chrome (CRD) using the **same** profile dir as Playwright, e.g. `/var/lib/whatorder-e2e/wa-web-profile`.
2. Install Playwright browsers on the VM:

```bash
cd backend
npm install
npm install playwright   # if not already in lockfile
npx playwright install chromium
```

3. Env (`.env.local` or shell on Contabo):

```bash
export E2E_WA_CUSTOMER_TRANSPORT=wa-web
export E2E_WA_WEB_USER_DATA_DIR=/var/lib/whatorder-e2e/wa-web-profile
export E2E_WA_WEB_HEADLESS=1          # 0 under CRD to re-QR / debug
# optional: use system Google Chrome binary (same as CRD)
# export E2E_WA_WEB_CHANNEL=chrome
export E2E_WA_TARGET=test
# Firebase Admin for Test Firestore (same as backend Test)
```

**Profile must match the browser that scanned the QR.** If CRD Chrome is logged in under `~/.config/google-chrome` but Playwright uses `/var/lib/whatorder-e2e/wa-web-profile`, you get “chat list not found”. Fix:

1. **Close all Chrome windows** on Contabo (profile lock).
2. Either point `E2E_WA_WEB_USER_DATA_DIR` at Chrome’s user-data-dir:

```bash
export E2E_WA_WEB_USER_DATA_DIR=$HOME/.config/google-chrome
export E2E_WA_WEB_CHANNEL=chrome
```

   Or re-QR into the Playwright dir under CRD:

```bash
export E2E_WA_WEB_HEADLESS=0
export DISPLAY=:20   # or whatever CRD uses — run from a terminal inside CRD session
npx playwright open https://web.whatsapp.com --user-data-dir=/var/lib/whatorder-e2e/wa-web-profile
# scan QR, then re-run e2e with HEADLESS=1
```

On login failure the runner writes a PNG under `/tmp/e2e-wa-web/`.

4. Smoke:

```bash
npm run e2e:wa -- --target test --scenario happy_cash_pickup
# or pack A
npm run e2e:wa -- --all-pack-a
```

If WA Web shows QR / “abgemeldet”, re-link via CRD before re-running. Do not wipe the profile dir between CI runs.

## Targets

```bash
npm run e2e:wa -- --all-pack-a
npm run e2e:wa -- --target test-benat --all-pack-a
npm run e2e:wa -- --target preprod --all-pack-a
E2E_WA_ALLOW_PROD=1 npm run e2e:wa -- --target prod --scenario happy_cash_pickup
```

**Hard rule:** default test bot Meta id is `1227165440469679` (`+43 681 20575797`). Runner aborts on prod id unless allowed.

## Legacy graph transport (deprecated)

```bash
# Terminal A: reply-server + ngrok → Meta customer webhook
npm run e2e:wa:reply-server
# Terminal B:
E2E_WA_CUSTOMER_TRANSPORT=graph E2E_WA_CUSTOMER_ACCESS_TOKEN=… npm run e2e:wa -- --scenario happy_cash_pickup
```

Pack A `waitForReply` fails on this path when restaurant → Cloud API customer delivery is `failed`.
