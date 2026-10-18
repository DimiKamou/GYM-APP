// `defineConfig` comes from vitest/config, not vite: vite's own overload does not
// know the `test` key, so the config below would not typecheck against it.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// The service worker ships with the Play Store build: an installed app that opens to Chrome's
// offline page is a broken app. It is generated here and registered by hand in
// src/pwa/serviceWorker.ts, which is where the rules live — a new build waits for a tap, and
// never while the outbox is holding writes. The manifest stays the static file in public/.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'generateSW',
      // 'prompt': the worker waits until the app posts SKIP_WAITING, i.e. until someone taps.
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      workbox: {
        // woff2 only: every browser that can run this app reads it, and the woff fallbacks
        // the font packages also emit would double the fonts in the offline cache.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: '/index.html',
        // Not the SPA: the Digital Asset Links file Android checks the domain with, and the
        // two static legal pages, which must load as themselves (cleanUrls serves them
        // without the extension).
        navigateFallbackDenylist: [/^\/\.well-known\//, /^\/privacy/, /^\/delete-account/],
        cleanupOutdatedCaches: true,
        // Supabase is never cached here. Reads have the persisted query cache, with its own
        // ages and its own wipe on sign-out; a second, invisible cache of the same rows would
        // survive that wipe.
        runtimeCaching: [],
      },
    }),
  ],
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
