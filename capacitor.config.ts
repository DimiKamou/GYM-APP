import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The store apps. One codebase: `npm run build` → `npx cap sync` copies `dist/` into both
 * native projects. See STORES.md for the whole release path.
 *
 * `appId` is permanent once uploaded to either store, and must match `APP_SCHEME` in
 * src/native/platform.ts — the scheme the providers send a sign-in back to.
 */
const config: CapacitorConfig = {
  appId: 'gr.powerhouse.app',
  appName: 'PowerHouse',
  webDir: 'dist',
  android: {
    // A release build never loads http:, and neither should a debug one by accident.
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
  },
  plugins: {
    CapacitorUpdater: {
      // Download quietly, announce, and wait for the tap. See src/native/liveUpdate.ts.
      autoUpdate: 'onlyDownload',
      // Generous: a cold start on an old Android phone with a big persisted cache is slow,
      // and a false rollback ships yesterday's bug back.
      appReadyTimeout: 20_000,
    },
  },
}

export default config
