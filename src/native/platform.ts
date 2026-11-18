import { Capacitor } from '@capacitor/core'

/**
 * Where this build runs, and the one address every link it hands out must use.
 *
 * Inside the store apps the page is served from the device (`https://localhost` on Android,
 * `capacitor://localhost` on iOS). A link built from `window.location.origin` there points at
 * the phone that made it — the athlete taps an invite and gets nothing. So links come from
 * `VITE_PUBLIC_ORIGIN`, the hosted site, whenever the build is native.
 */

export const isNative: boolean = Capacitor.isNativePlatform()
export const nativePlatform: 'ios' | 'android' | 'web' = Capacitor.getPlatform() as 'ios' | 'android' | 'web'

/** The custom scheme the providers send a native sign-in back to. Must match the app id. */
export const APP_SCHEME = 'gr.powerhouse.app'
export const NATIVE_CALLBACK = `${APP_SCHEME}://auth/callback`

export function publicOrigin(): string {
  const configured = ((import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined) ?? '').trim().replace(/\/+$/, '')
  if (configured) return configured
  return typeof window === 'undefined' ? '' : window.location.origin
}
