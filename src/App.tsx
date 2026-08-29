import type { CSSProperties } from 'react'
import { RouterProvider } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'

import { ThemeProvider } from '@/theme/ThemeProvider'
import { AuthProvider } from '@/auth/AuthProvider'
import { persistOptions, queryClient } from '@/data/queryClient'
import { i18n } from '@/i18n'
import { router } from '@/router'

/**
 * The provider stack, outermost first.
 *
 *  - `ThemeProvider` — outermost, because it stamps `data-theme` on `<html>` before anything
 *    paints. Anything above it would be able to render a frame in the wrong theme.
 *  - `I18nextProvider` — above the router, because route elements (including the boot state and
 *    the error screen) translate.
 *  - `PersistQueryClientProvider` — the read cache is restored from IndexedDB before the first
 *    query runs, so a coach on a dead connection sees last week's briefing instead of a spinner.
 *  - `AuthProvider` — inside Query, because resolving a membership is itself a query, and
 *    outside the router, because every route guard reads it.
 */

/**
 * The frame. A phone UI, centred and capped on a desktop rather than stretched: these screens
 * are lists of short rows, and a 1400px-wide row of "Νίκος Παπαδόπουλος · 10 προπονήσεις" is
 * unreadable in a way the 390px original is not.
 *
 * `100dvh`, not `100vh`: on mobile Safari `100vh` is the height with the toolbars *hidden*, so
 * the tab bar sits below the fold until the user scrolls.
 */
const frame: CSSProperties = {
  height: '100dvh',
  width: '100%',
  maxWidth: 480,
  margin: '0 auto',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: 'var(--th-bg)',
  backgroundImage: 'var(--th-bg-image)',
}

export function App() {
  return (
    <ThemeProvider>
      <I18nextProvider i18n={i18n}>
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <AuthProvider>
            <div style={frame}>
              <RouterProvider router={router} />
            </div>
          </AuthProvider>
        </PersistQueryClientProvider>
      </I18nextProvider>
    </ThemeProvider>
  )
}
