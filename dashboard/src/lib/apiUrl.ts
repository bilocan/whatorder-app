/**
 * Backend base URL. In local dev, leave VITE_API_URL unset — Vite proxies /admin and /api to :3000.
 * Set VITE_API_URL only for production builds or when the API is on another host.
 */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
