# Development Setup Guide

Full day-1 onboarding lives in the vault: `whatorder-vault/Onboarding/developer-onboarding.md`. This is the short version.

## Branching & deploys

`dev` is the default branch — create feature branches from it, never from `master`.

```
feature/* ──PR──▶ dev ──auto-deploy──▶ TEST (whatorder-fire)
                   │
                   └──PR (dev only)──▶ master ──gh release──▶ PROD (whatorder-fire-prod)
```

- Direct pushes to `dev` and `master` are blocked (PRs only, CI checks required).
- PRs into `master` are only accepted from `dev` (enforced by the *Master merge guard* check).
- Merging to `master` deploys nothing; production ships when a GitHub Release is published:
  `gh release create v2026.07.0 --target master --generate-notes`

Full workflow: vault `Projects/WhatOrder/specs/dev-workflow-guide.md`; infra details: `specs/environments-and-branching.md`.

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

Health check: `curl http://localhost:3000/health` → `{"status":"OK","timestamp":"..."}`
