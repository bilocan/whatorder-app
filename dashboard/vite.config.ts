import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
