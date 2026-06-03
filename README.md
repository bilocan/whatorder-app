# WhatOrder MVP

WhatsApp-based order management platform for small restaurants, döner shops, and food businesses in Vienna.

**Architecture:** Hybrid (Cloud + Local)
- Cloud backend (Firebase): Receives WhatsApp messages, stores orders
- Flutter mobile app (iOS/Android): Owner views/manages orders, works offline
- Web dashboard: Touchscreen device at restaurant
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
├── mobile/                     # Flutter (iOS + Android)
│   ├── lib/
│   │   ├── screens/           # UI screens
│   │   ├── models/            # Data models
│   │   ├── services/          # Firebase, API calls
│   │   ├── widgets/           # Reusable widgets
│   │   └── main.dart          # Entry point
│   └── pubspec.yaml
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

### 2. Mobile Setup (Flutter)
```bash
cd mobile
flutter pub get
flutter run
```

## Tech Stack

**Backend:**
- Node.js + Express
- Firebase Firestore (database)
- Google Cloud Run (hosting)
- WhatsApp Business API

**Mobile:**
- Flutter (iOS + Android)
- Firebase (authentication, real-time sync)
- Offline-first architecture

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
