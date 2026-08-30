import type { CSSProperties, ReactNode } from 'react'
import {
  createBrowserRouter,
  createHashRouter,
  Link,
  Navigate,
  Outlet,
  useLocation,
  useRouteError,
  type RouteObject,
} from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import { Screen } from '@/ui/Screen'
import { TabBar } from '@/ui/TabBar'
import { AthletesScreen } from '@/screens/AthletesScreen'
import { AthleteDetailScreen } from '@/screens/AthleteDetailScreen'
import { LogScreen } from '@/screens/LogScreen'
import { CalendarScreen } from '@/screens/CalendarScreen'
import { LibraryScreen } from '@/screens/LibraryScreen'
import { TeamScreen } from '@/screens/TeamScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { AuthScreen } from '@/screens/AuthScreen'
import { JoinScreen } from '@/screens/JoinScreen'

/**
 * Routes.
 *
 * Two shapes only: **tabs**, which keep the tab bar, and **pushes** (athlete detail, workout
 * log), which take the whole frame. That is the prototype's structure and it is the right one
 * — a coach mid-set should not be able to leave the log by mis-tapping a tab.
 *
 * `/login` and `/join` are public. Everything else is behind `RequireAuth`, which has a real
 * loading state: an already-signed-in trainer must never see the login screen flash while the
 * Supabase session is being restored from storage. That flash is not cosmetic — it teaches the
 * trainer that the app logs them out, and the next thing they do is share a login.
 */

/**
 * The slot the routed screen renders into. `order: 1` keeps it between a top-placed tab bar
 * (order 0 on desktop) and a bottom-placed one (order 2 on a phone) without any route knowing
 * which layout it is in.
 */
const outletSlot: CSSProperties = {
  order: 1,
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
}

/**
 * Boot state. Deliberately not a spinner over the login form: it is the wordmark on the theme's
 * own ground, so restoring a session looks like the app starting rather than like a failure.
 */
function BootScreen() {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      aria-busy="true"
      style={{
        ...outletSlot,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
      }}
    >
      <span
        className="display"
        aria-hidden="true"
        style={{ fontSize: 'var(--th-text-xl)', color: 'var(--th-muted)' }}
      >
        {t('brand.name')}
      </span>
      <span className="sr-only">{t('auth.checkingSession')}</span>
    </div>
  )
}

/**
 * The gate. `AuthStatus` has six values and only one of them is "let them in"; the rest are
 * handled explicitly rather than folded into a single `!signedIn`, because `no-membership` —
 * a real account that belongs to no gym — needs the invite screen, not the login screen it
 * has just come from.
 */
function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <BootScreen />
  if (status === 'ready') return <Outlet />
  if (status === 'no-membership') return <Navigate to="/join" replace />

  // `signed-out`, `unconfigured` and `error` all land on the login screen: it is the screen
  // that owns the missing-env notice and the retry.
  // `pathname + search` only. `location.hash` is deliberately excluded: on `/join` the
  // fragment is a live invite secret, and history state is persisted by the browser.
  return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
}

/**
 * Keeps a signed-in trainer out of the login screen, including on a bookmarked `/login`.
 * Only `ready` redirects — `no-membership` and `error` have to be able to sit on this screen,
 * or they bounce between the two forever.
 */
function RedirectWhenReady({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') return <BootScreen />
  if (status === 'ready') return <Navigate to="/athletes" replace />
  return <>{children}</>
}

function TabsLayout() {
  return (
    <>
      <div style={outletSlot}>
        <Outlet />
      </div>
      <TabBar />
    </>
  )
}

/**
 * A route with no tab bar: the two pushes, and the public screens. It carries the bottom
 * safe-area inset that the tab bar carries on the tabbed routes, so content never sits under
 * the iOS home indicator.
 */
function FullScreenLayout() {
  return (
    <div style={{ ...outletSlot, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <Outlet />
    </div>
  )
}

function PublicLayout() {
  return (
    <RedirectWhenReady>
      <FullScreenLayout />
    </RedirectWhenReady>
  )
}

function NotFoundScreen() {
  const { t } = useTranslation()
  return (
    <div style={{ ...outletSlot, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <Screen label={t('errors.notFoundTitle')}>
        <h1 className="display" style={{ fontSize: 'var(--th-text-2xl)', margin: 0 }}>
          {t('errors.notFoundTitle')}
        </h1>
        <p style={{ margin: 0, color: 'var(--th-muted)' }}>{t('errors.notFoundBody')}</p>
        <Link
          to="/athletes"
          style={{
            color: 'var(--th-accent)',
            fontWeight: 600,
            alignSelf: 'flex-start',
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {t('errors.backToAthletes')}
        </Link>
      </Screen>
    </div>
  )
}

/**
 * The last line of defence. Without it a throw anywhere under the router replaces the whole app
 * with React Router's default stack trace, which on a phone in a gym is indistinguishable from
 * the app being broken forever.
 */
function RouteErrorScreen() {
  const { t } = useTranslation()
  const error = useRouteError()
  // The message is for whoever is holding the phone during the pilot, not for the athlete.
  const detail = import.meta.env.DEV && error instanceof Error ? error.message : null

  return (
    <div style={{ ...outletSlot, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <Screen label={t('errors.genericTitle')}>
        <h1 className="display" style={{ fontSize: 'var(--th-text-2xl)', margin: 0 }}>
          {t('errors.genericTitle')}
        </h1>
        <p style={{ margin: 0, color: 'var(--th-muted)' }}>{t('errors.genericBody')}</p>
        {detail ? (
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              fontSize: 'var(--th-text-sm)',
              color: 'var(--th-danger)',
            }}
          >
            {detail}
          </pre>
        ) : null}
        <Link
          to="/athletes"
          style={{
            color: 'var(--th-accent)',
            fontWeight: 600,
            alignSelf: 'flex-start',
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {t('errors.backToAthletes')}
        </Link>
      </Screen>
    </div>
  )
}

/**
 * The route table, separate from the browser router so it can be mounted on a memory router in
 * a test. A guard is exactly the kind of code that is only ever exercised by hand otherwise.
 */
export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorScreen />,
    children: [
      {
        element: <PublicLayout />,
        children: [{ path: 'login', element: <AuthScreen /> }],
      },
      {
        // `/join` is reachable signed-in or signed-out: the invite has to survive the round
        // trip through the login screen, and redirecting it away would drop the fragment.
        element: <FullScreenLayout />,
        children: [{ path: 'join', element: <JoinScreen /> }],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <TabsLayout />,
            children: [
              { index: true, element: <Navigate to="/athletes" replace /> },
              { path: 'athletes', element: <AthletesScreen /> },
              { path: 'calendar', element: <CalendarScreen /> },
              { path: 'library', element: <LibraryScreen /> },
              { path: 'team', element: <TeamScreen /> },
              { path: 'settings', element: <SettingsScreen /> },
            ],
          },
          {
            element: <FullScreenLayout />,
            children: [
              { path: 'athletes/:athleteId', element: <AthleteDetailScreen /> },
              { path: 'log/:sessionId', element: <LogScreen /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundScreen /> },
    ],
  },
]

/**
 * Hash routing exists for one job: the single-file preview build, which is opened straight from
 * a file or a static host with no rewrite rule, where a deep link to /athletes would 404 before
 * React ever loads. The deployed app uses real paths — the URL a coach shares should not carry a
 * hash — so this is a build flag, not a runtime choice.
 */
export const router = import.meta.env.VITE_HASH_ROUTER
  ? createHashRouter(routes)
  : createBrowserRouter(routes)
