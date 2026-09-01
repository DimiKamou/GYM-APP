// `defineConfig` comes from vitest/config, not vite: vite's own overload does not
// know the `test` key, so the config below would not typecheck against it.
import { defineConfig } from 'vitest/config'
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
  build: {
    rollupOptions: {
      output: {
        // Trainers open this on gym wifi, and the parts that change are not the parts that are
        // large. Splitting the three big dependencies off the app chunk means a redeploy — which
        // during the pilot happens between clients — re-downloads the app code alone and leaves
        // ~400 kB of vendor code in the browser cache.
        manualChunks: {
          supabase: ['@supabase/supabase-js'],
          query: [
            '@tanstack/react-query',
            '@tanstack/react-query-persist-client',
            '@tanstack/query-async-storage-persister',
          ],
          i18n: ['i18next', 'react-i18next'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
    css: true,
  },
})
