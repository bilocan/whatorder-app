/**
 * Backend base URL for dashboard → API calls (approve, admin, geocode, …).
 *
 * Vite dev: always same-origin — `/api` and `/admin` proxy to localhost:3000 (LAN-safe).
 * Production build: `VITE_API_URL` → Cloud Run.
 *
 * Hosted dashboard (Firebase) always uses Cloud Run. For local bot + test number, use
 * `npm run dev` dashboard at :5173, not the hosted URL.
 */
export const API_URL = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
