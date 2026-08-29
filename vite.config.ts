import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// The service worker is deliberately NOT registered yet (see M5 in the build plan).
// During a live pilot a service worker serves trainers the bug you fixed an hour ago;
// being able to redeploy a fix between two clients is the whole reason we chose the web.
// vite-plugin-pwa is installed and wired in M5, once the code stops changing daily.
// The manifest itself ships now, as a static file in public/ — that is the no-app-store premise.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { host: true, port: 5173 },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
    css: true,
  },
})
