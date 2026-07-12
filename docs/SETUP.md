# Development Setup Guide

Full day-1 onboarding lives in the vault: `whatorder-vault/Onboarding/developer-onboarding.md`. This is the short version.

## Branching & deploys

`dev` is the default branch — create feature branches from it, never from `master`.

```
feature/* ──PR──▶ dev ──auto-deploy──▶ TEST (whatorder-fire)
                   │
                   └──PR (dev only)──▶ master ──auto-deploy──▶ PREPROD (whatorder-fire-prod)
                                              │
                                              └──gh release──▶ PROD (promote same SHA)
```

- Direct pushes to `dev` and `master` are blocked (PRs only, CI checks required).
- PRs into `master` are only accepted from `dev` (enforced by the *Master merge guard* check).
- Merging to `master` deploys **Preprod** (`pre.whatorder.at`). Production ships when a GitHub Release is published (promotes the same image SHA):
  `npm run release` (see vault `Projects/WhatOrder/notes/deploy-test-to-prod.md`)

Full workflow: vault `Projects/WhatOrder/specs/dev-workflow-guide.md`; infra details: `specs/environments-and-branching.md`.

## Cursor loop prompts

Recurring agent checks (intent harvest, CI, prod cutover smoke): vault `Projects/WhatOrder/notes/loop-engineering-playbook.md`. Paste a block into Cursor as `/loop 20m …` while working in an active session.

## Environment variables

Secrets are synced from GCP Secret Manager (`whatorder-fire`) — no manual `.env` editing:

```bash
npm run env:pull   # writes .env + backend/.env.local
```

Requires `gcloud auth application-default login` first. Details: vault `notes/dev-secrets-gcp.md`.

## Backend (Node.js)

```bash
cd backend
npm install
npm run dev
```

Server runs on http://localhost:3000

## Dashboard (React + Vite)

```bash
cd dashboard
npm install
npm run dev
```

Dashboard runs on http://localhost:5173

## Testing

```bash
cd backend && npm test
cd dashboard && npm test
cd dashboard && npx tsc --noEmit && npx eslint src --max-warnings 0
```

Health check: `curl http://localhost:3000/health` → includes `status`, `timestamp`, `environment`, `version`, `gitSha`, `firebaseProject`

Version only: `curl http://localhost:3000/version` → build metadata without liveness fields. Cloud Run Test/Prod set `DEPLOY_ENV`, `GIT_SHA`, `APP_VERSION` at deploy time.
