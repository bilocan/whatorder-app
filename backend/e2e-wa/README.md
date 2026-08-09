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

## Data-driven scripts

Scenarios in Pack A and Pack C may use YAML scripts in `e2e-wa/scripts/<id>.yml`; Pack B remains JS-only. Use the existing `macro`, `send`, `tap`, `expect_reply`, `gate`, and `sleep` steps; reply-copy checks may be soft, but every scenario must include a named hard gate. Add new reusable behavior to the interpreter as a macro or gate instead of embedding JavaScript in YAML.

**Pack A example:** `scripts/happy_stripe_delivery.yml` (checkout → Stripe delivery order).

**Pack C examples:**

| Script | Manual ref | Hard gates |
|--------|------------|------------|
| `neg_confirm_digit.yml` | M2 rows 12, 37 | `no_order`, `state` confirming |
| `basket_edit_mid_checkout.yml` | M1 rows 4–5 | `basket_qty` ayran eq 2, `no_order` |
| `happy_delivery_address_prompt.yml` | M2 row 50 | address `state`, `order_stripe_delivery` |

```bash
npm run e2e:wa -- --script neg_confirm_digit
npm run e2e:wa -- --script basket_edit_mid_checkout
npm run e2e:wa -- --script happy_delivery_address_prompt
npm run e2e:wa -- --all-pack-c
npm run e2e:wa -- --list
```

The default nightly run remains Pack A+B, including YAML scenarios registered in Pack A. Pack C is not nightly by default; verify new Pack C scripts on Contabo before promoting them.

## Contabo live run (wa-web)

**Important:** Chrome `headless=true` often never shows a logged-in WhatsApp Web UI. On Contabo use **headed Chromium under Xvfb**. Default browser channel is system **Google Chrome** (`E2E_WA_WEB_CHANNEL=chrome`) because WA Web rejects old Playwright-bundled Chromium.

```bash
sudo apt-get install -y xvfb   # once

cd /home/whatorder/whatorder-app/backend
mkdir -p /var/lib/whatorder-e2e/wa-web-profile
```

### 1) QR once into the Playwright profile (inside CRD desktop)

```bash
# terminal inside Chrome Remote Desktop — not plain SSH
echo $DISPLAY   # should be set, e.g. :20
npx playwright open https://web.whatsapp.com \
  --user-data-dir=/var/lib/whatorder-e2e/wa-web-profile
# scan QR → chat list visible → close window
```

### 2) Diagnose (SSH ok with xvfb)

```bash
xvfb-run -a env \
  E2E_WA_CUSTOMER_TRANSPORT=wa-web \
  E2E_WA_WEB_USER_DATA_DIR=/var/lib/whatorder-e2e/wa-web-profile \
  E2E_WA_WEB_HEADLESS=0 \
  node e2e-wa/scripts/wa-web-diagnose.js
```

Expect `hasChatList=true`. If `hasQrCanvas=true` or login copy in body preview, re-do step 1. Check `/tmp/e2e-wa-web/*.png`.

### 3) Run scenario

```bash
xvfb-run -a env \
  E2E_WA_CUSTOMER_TRANSPORT=wa-web \
  E2E_WA_WEB_USER_DATA_DIR=/var/lib/whatorder-e2e/wa-web-profile \
  E2E_WA_WEB_HEADLESS=0 \
  E2E_WA_TARGET=test \
  npm run e2e:wa -- --target test --scenario happy_stripe_pickup
```

Do **not** use `E2E_WA_WEB_HEADLESS=1` until diagnose passes under xvfb. Do **not** `pkill -f chrome` (kills CRD).

**Profile must match the browser that scanned the QR.** `playwright open` and the e2e runner must share `E2E_WA_WEB_USER_DATA_DIR`.

### 4) Firebase Admin (Test Firestore)

`waitForOrder` / owner actions need Test project Admin SDK on Contabo. Copy the same Firebase vars you use in local `backend/.env.local` (Test = `whatorder-fire`):

```bash
# in backend/.env.local on Contabo (never commit)
FIREBASE_PROJECT_ID=whatorder-fire
FIREBASE_CLIENT_EMAIL=…        # Test Admin SDK service account
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…"
# or:
# FIREBASE_SERVICE_ACCOUNT_BASE64=…
```

Or pull secrets the usual way from the laptop/repo (`npm run env:pull` if you use GCP Secret Manager). Confirm:

```bash
cd backend && node -e "require('dotenv').config({path:'.env.local'}); require('./src/lib/firebase'); console.log('ok', process.env.FIREBASE_PROJECT_ID)"
```


## Targets

```bash
npm run e2e:wa -- --all-pack-a
npm run e2e:wa -- --all-pack-b
npm run e2e:wa -- --target test-benat --all-pack-a
npm run e2e:wa -- --target preprod --all-pack-a
E2E_WA_ALLOW_PROD=1 npm run e2e:wa -- --target prod --scenario happy_stripe_pickup
```

Pack B (Contabo, after pack A green):

```bash
xvfb-run -a env \
  E2E_WA_CUSTOMER_TRANSPORT=wa-web \
  E2E_WA_WEB_USER_DATA_DIR=/var/lib/whatorder-e2e/wa-web-profile \
  E2E_WA_WEB_HEADLESS=0 \
  E2E_WA_TARGET=test \
  npm run e2e:wa -- --target test --all-pack-b
```

**Hard rule:** default test bot Meta id is `1227165440469679` (`+43 681 20575797`). Runner aborts on prod id unless allowed.

## Nightly / on-demand (GitHub Actions)

Self-hosted runner on Contabo: label `e2e-wa-web`, host `contabo-e2e-wa`.

Workflow: `.github/workflows/e2e-wa.yml` — `schedule` (03:00 UTC) + `workflow_dispatch` only. **Not** on PRs.

```bash
# after workflow is on the remote branch:
gh workflow run e2e-wa.yml --ref feature/whatsapp-e2e-automation
```

Diagnose exit codes: `0` ok, `2` session dead (workflow **fails** the job; re-link via Contabo CRD), `1` unexpected error. Secrets: Contabo `backend/.env.local` (symlinked into the job workspace).

**Safety:** `loadConfig` requires `FIREBASE_PROJECT_ID=whatorder-fire` for `target=test` (refuses `whatorder-fire-prod` unless preprod/prod + allow). Reply-server binds `127.0.0.1` by default (`E2E_WA_REPLY_HOST` to override).

## Legacy graph transport (deprecated)

```bash
# Terminal A: reply-server + ngrok → Meta customer webhook
npm run e2e:wa:reply-server
# Terminal B:
E2E_WA_CUSTOMER_TRANSPORT=graph E2E_WA_CUSTOMER_ACCESS_TOKEN=… npm run e2e:wa -- --scenario happy_stripe_pickup
```

Pack A `waitForReply` fails on this path when restaurant → Cloud API customer delivery is `failed`.
