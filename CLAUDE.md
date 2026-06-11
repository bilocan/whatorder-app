# WhatOrder — Claude Code Instructions

## Vault
All project memory, specs, and decisions live in the Obsidian vault at:
`c:\Users\Hamza\Documents\Pers\software\WhatOrder\whatorder-vault\Projects\WhatOrder\`

- `specs/` — authoritative specs and architecture docs
- `notes/` — session debriefs, working notes
- `releases/` — changelog (unreleased.md)

Use `Glob` / `Grep` directly on the vault path instead of spawning an agent to list files.
Save implementation plans and decisions to the vault, not to Claude's memory system.

## Key specs to read before making structural changes
- `specs/technical-architecture.md` — system overview, Firestore schema, data flow
- `specs/bot-state-machine.md` — **all bot states, transitions, session schema** (read before touching `botHandler.js` or `sessionStore.js`)
- `specs/security-multitenant.md` — tenant isolation rules (read before touching data model)
- `specs/mvp-spec.md` — what is and isn't in scope
- `specs/build-roadmap.md` — current phase and what's next

## Bot state machine sync rule
`specs/bot-state-machine.md` and `backend/src/bot/botHandler.js` are co-authoritative.
When adding or changing any state, transition, or session field:
1. Update `specs/bot-state-machine.md` first (or in the same commit)
2. Keep the Mermaid diagram, transition table, and session schema section in sync

## Firestore collections sync rule
When adding or changing a Firestore collection:
1. Add/update the ref in `backend/src/lib/collections.js`
2. Update the "Firestore Collections Schema" section in `specs/technical-architecture.md`
All collections must be accessed through `collections.js` — no direct `db.collection()` calls elsewhere.

## Workflow rules
- When the user says "task done", run the vault task-done workflow: check unreleased.md → update release log → update Asana → check commit messages
- Asana project GID: `1215389891247928` (WhatOrder MVP) — use directly, never look it up
- Never touch any HalalScan assets or Asana projects

## Stack
- Backend: Node.js + Express, deployed on Google Cloud Run
- Database: Firebase Firestore (firebase-admin SDK)
- Frontend: React + TypeScript + Vite, deployed on Firebase Hosting
- WhatsApp: Meta Cloud API v21.0 (see `backend/src/lib/whatsapp.js`)
- Tests: Jest (backend, 177 tests), Vitest + RTL (dashboard, 17 tests)
