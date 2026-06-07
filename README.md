# WhatOrder MVP

WhatsApp-based order management platform for small restaurants, döner shops, and food businesses in Vienna.

**Architecture:** Cloud + Web
- Cloud backend (Firebase): Receives WhatsApp messages, stores orders
- React web dashboard: Owner views/manages orders from any device (browser)
- Data export: Owner can backup/export orders anytime

## Project Structure

```
WhatOrder/
├── backend/                    # Node.js + Express + Firebase
│   ├── src/
│   │   ├── controllers/       # Request handlers
│   │   ├── routes/            # API endpoints
│   │   ├── services/          # Business logic
│   │   └── models/            # Data models
│   ├── config/                # Firebase, WhatsApp config
│   ├── package.json
│   └── .env                   # Secrets (WhatsApp API keys)
│
├── dashboard/                  # React + Vite + TypeScript
│
├── docs/                       # Documentation
│   ├── API.md                 # API endpoints
│   ├── DEPLOYMENT.md          # How to deploy
│   └── SETUP.md               # Local development setup
│
└── README.md                   # This file
```

## Quick Start

### 1. Backend Setup (Node.js)
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with WhatsApp API credentials
npm start
```

### 2. Dashboard Setup (React)
```bash
cd dashboard
npm install
npm run dev
```

## Tech Stack

**Backend:**
- Node.js + Express
- Firebase Firestore (database)
- Google Cloud Run (hosting)
- WhatsApp Business API

**Dashboard:**
- React + Vite + TypeScript
- Firebase JS SDK (real-time sync)

## MVP Timeline

- **Week 1-4 (June):** Build core features
- **Week 5-8 (July):** Pilot + polish
- **Week 9-12 (August):** Launch + scale

## Quick Links

- Vault specs: `C:\Users\Hamza\Documents\Pers\AI\obsidian\whatorder\`
- Development setup: See `docs/SETUP.md`
- API docs: See `docs/API.md`

## License

Private project.
