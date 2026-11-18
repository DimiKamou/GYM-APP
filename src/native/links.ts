import { App, type URLOpenListenerEvent } from '@capacitor/app'
import { Browser } from '@capacitor/browser'

import { APP_SCHEME, isNative, publicOrigin } from '@/native/platform'

/**
 * Addresses that arrive from outside the store app.
 *
 *  - `gr.powerhouse.app://auth/callback?code=…` — a provider handing a sign-in back. The browser
 *    sheet is closed and the code goes to the same `/auth/callback` screen the website uses, so
 *    there is one exchange and one set of failure messages, not two.
 *  - `https://<public origin>/…` — an invite, a share link or a sign-in link the phone chose to
 *    open in the app (Android App Links / iOS universal links). Routed in place, fragment
 *    included: invite secrets live in the fragment.
 *
 * Anything else is ignored. A scheme any other app can fire must not be able to send this one
 * to an arbitrary route with arbitrary state.
 */

type Navigate = (to: string, options?: { replace?: boolean }) => unknown

export async function openInAppBrowser(url: string): Promise<void> {
  await Browser.open({ url, presentationStyle: 'popover' })
}

/** The in-app route an outside address maps to, or null for one this app does not take. */
export function routeForAppUrl(raw: string, origin: string = publicOrigin()): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol === `${APP_SCHEME}:`) {
    // `scheme://auth/callback` parses with `auth` as the host on some engines and as the
    // first path segment on others.
    const path = `/${url.host}${url.pathname}`.replace(/\/{2,}/g, '/').replace(/\/$/, '')
    return path === '/auth/callback' ? `/auth/callback${url.search}` : null
  }
  if (origin && url.origin === origin) return `${url.pathname}${url.search}${url.hash}`
  return null
}

export function registerNativeLinks(navigate: Navigate): void {
  if (!isNative) return
  void App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    const route = routeForAppUrl(event.url)
    if (!route) return
    if (route.startsWith('/auth/callback')) void Browser.close().catch(() => undefined)
    // The invite screens and the callback read `window.location` directly, so the router has
    // to have moved before they mount — which `navigate` guarantees.
    void navigate(route, { replace: route.startsWith('/auth/callback') })
  })
}
