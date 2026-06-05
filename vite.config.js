import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Dev-only: forward API calls to the Express server (server.js on :3000)
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
