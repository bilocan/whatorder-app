import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      filename: 'sw.js',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'assets/logo-mark.svg'],
      devOptions: { enabled: false },
      manifest: {
        name: 'WhatOrder',
        short_name: 'WhatOrder',
        description: 'Restaurant order dashboard',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#FAFAFA',
        theme_color: '#22C55E',
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: '/index.html',
        // `/admin` is a React route (App.tsx). Do not denylist it.
        // `/api` `/health` `/version` are Vite dev proxies only; keep as a local-preview safety net.
        // Last pattern: missing static files must not fall back to HTML.
        navigateFallbackDenylist: [/^\/api/, /^\/health/, /^\/version/, /\/[^/?]+\.[^/]+$/],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    host: true,
    proxy: {
      '/admin': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/version': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
})
