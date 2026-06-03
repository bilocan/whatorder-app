# Development Setup Guide

## Backend (Node.js)

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your credentials
npm run dev
```

Server runs on http://localhost:3000

## Mobile (Flutter)

```bash
cd mobile
flutter pub get
flutter run
```

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in:
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_CLIENT_EMAIL`

See the vault specs for how to get these: `C:\Users\Hamza\Documents\Pers\AI\obsidian\whatorder\Projects\WhatOrder\specs\whatsapp-api-setup.md`

## Testing

Test webhook:
```bash
curl -X GET "http://localhost:3000/health"
```

Should return: `{"status":"OK","timestamp":"..."}`
