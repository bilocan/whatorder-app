import '@testing-library/jest-dom'
import { vi } from 'vitest'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'

// Prevent real Firebase init in CI (no .env.local / VITE_FIREBASE_*).
vi.mock('../lib/firebase', () => ({
  db: {},
  auth: { currentUser: null },
  storage: {},
}))

// Initialize i18next once for all tests, using English.
// i18n.ts guards against double-init with isInitialized check.
i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})
