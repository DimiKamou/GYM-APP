import { CapacitorUpdater } from '@capgo/capacitor-updater'

import { isNative } from '@/native/platform'
import { announce } from '@/pwa/serviceWorker'

/**
 * Live updates in the store apps (Capgo), under the same rule as the website's service worker:
 * a new build is downloaded quietly and then WAITS for a tap on the update banner — which itself
 * waits while the outbox holds writes. A coach is never reloaded mid-set.
 *
 * `capacitor.config.ts` sets `autoUpdate: 'onlyDownload'`: the plugin checks and downloads on
 * every return to the foreground and emits `updateAvailable`, and never swaps the bundle by
 * itself. Only JS/CSS/HTML travels this way; a change to native code (a plugin, a permission,
 * the icon) still needs a store release, and Capgo refuses a bundle built for another native
 * version.
 */
export function registerLiveUpdates(): void {
  if (!isNative) return
  // Within `appReadyTimeout` of every launch, or Capgo decides the bundle is broken and rolls
  // back to the previous one. Called at boot, before anything that could fail on a bad build
  // has had a chance to — so a bundle that crashes during module evaluation never gets here.
  void CapacitorUpdater.notifyAppReady().catch(() => undefined)
  void CapacitorUpdater.addListener('updateAvailable', ({ bundle }) => {
    announce(() => {
      void CapacitorUpdater.set({ id: bundle.id })
    })
  })
}
