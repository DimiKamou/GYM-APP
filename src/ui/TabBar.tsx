import { useCallback, useSyncExternalStore, type CSSProperties } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import { Icon, type IconName } from '@/ui/Icon'
import type { TranslationKey } from '@/i18n'

/**
 * The five tabs. The owner's five swap Ομάδα for Πίνακας (OWNER_TABS).
 *
 * Placement is not decoration. On a phone the bar sits at the bottom, inside the thumb's arc,
 * with the home-indicator inset added to its padding — this runs as an installed PWA on iOS,
 * where a bar flush to the bottom edge is half-covered by the system indicator. On a desktop
 * viewport there is no thumb and no inset, so the same five links move to the top of the
 * column, where a pointer expects navigation.
 */

interface Tab {
  to: string
  icon: IconName
  label: TranslationKey
  /** Other routes this tab owns: Προγράμματα is the library's second half. */
  also?: readonly string[]
}

/**
 * The owner's bar: Πίνακας first, in Ομάδα's place — team management is a tab of the dashboard
 * and stays one tap away, and five items keep every label whole on a 360px phone.
 */
const OWNER_TABS: readonly Tab[] = [
  { to: '/dashboard', icon: 'chart', label: 'nav.dashboard', also: ['/team'] },
  { to: '/athletes', icon: 'athletes', label: 'nav.athletes' },
  { to: '/calendar', icon: 'calendar', label: 'nav.calendar' },
  { to: '/library', icon: 'library', label: 'nav.library', also: ['/programs'] },
  { to: '/settings', icon: 'settings', label: 'nav.settings' },
]

const TABS: readonly Tab[] = [
  { to: '/athletes', icon: 'athletes', label: 'nav.athletes' },
  { to: '/calendar', icon: 'calendar', label: 'nav.calendar' },
  { to: '/library', icon: 'library', label: 'nav.library', also: ['/programs'] },
  { to: '/team', icon: 'team', label: 'nav.team' },
  { to: '/settings', icon: 'settings', label: 'nav.settings' },
]

const WIDE_QUERY = '(min-width: 900px)'

/**
 * `matchMedia` is wrapped because jsdom does not implement it and a locked-down browser can
 * throw on it; a tab bar that crashes the app is worse than a tab bar in the wrong place.
 */
function matchWide(): boolean {
  try {
    return window.matchMedia(WIDE_QUERY).matches
  } catch {
    return false
  }
}

function subscribeWide(onChange: () => void): () => void {
  let mql: MediaQueryList
  try {
    mql = window.matchMedia(WIDE_QUERY)
  } catch {
    return () => {}
  }
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function useWideViewport(): boolean {
  // Server snapshot is `false`: mobile-first means the phone layout is the one that renders
  // without a measurement.
  return useSyncExternalStore(subscribeWide, matchWide, () => false)
}

const linkBase: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  // 44px is the smallest reliably tappable target; a trainer is aiming while talking.
  minHeight: 44,
  minWidth: 44,
  padding: '6px 4px',
  borderRadius: 'var(--th-r-sm)',
  fontSize: 10,
  fontWeight: 600,
  // No tracking: «Ημερολόγιο» is the longest label, and it must fit a fifth of a 360px phone.
  letterSpacing: 0,
  textAlign: 'center',
}

export function TabBar() {
  const { t } = useTranslation()
  const { membership } = useAuth()
  const tabs = membership?.role === 'owner' ? OWNER_TABS : TABS
  const wide = useWideViewport()

  const navStyle: CSSProperties = {
    flex: '0 0 auto',
    // The frame is a flex column; order is what moves the bar between top and bottom without
    // the routes having to know which layout they are in.
    order: wide ? 0 : 2,
    background: 'var(--th-surface)',
    borderTop: wide ? 'none' : '1px solid var(--th-line)',
    borderBottom: wide ? '1px solid var(--th-line)' : 'none',
    paddingTop: 8,
    paddingBottom: wide ? 8 : 'calc(8px + env(safe-area-inset-bottom, 0px))',
    paddingLeft: 'calc(8px + env(safe-area-inset-left, 0px))',
    paddingRight: 'calc(8px + env(safe-area-inset-right, 0px))',
  }

  const { pathname } = useLocation()
  const owns = useCallback(
    (tab: Tab, isActive: boolean) => isActive || (tab.also ?? []).some((path) => pathname.startsWith(path)),
    [pathname],
  )
  const styleFor = (tab: Tab) => ({ isActive }: { isActive: boolean }): CSSProperties => {
    const active = owns(tab, isActive)
    return {
      ...linkBase,
      color: active ? 'var(--th-brand)' : 'var(--th-faint)',
      background: active ? 'var(--th-brand-soft)' : 'transparent',
    }
  }

  return (
    <nav aria-label={t('nav.primary')} style={navStyle}>
      <ul style={{ display: 'flex', alignItems: 'stretch' }}>
        {tabs.map((tab) => (
          <li key={tab.to} style={{ flex: 1, minWidth: 0 }}>
            {/* NavLink stamps aria-current="page" on the active link itself, which is the one
                thing a screen reader needs to say "you are here" without a visual cue. */}
            <NavLink to={tab.to} style={styleFor(tab)} className="hit">
              {({ isActive: own }) => {
                const isActive = owns(tab, own)
                return (
                <>
                  <Icon name={tab.icon} size={23} strokeWidth={isActive ? 2.1 : 1.6} />
                  <span
                    style={{
                      color: isActive ? 'var(--th-ink)' : 'var(--th-faint)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '100%',
                    }}
                  >
                    {t(tab.label)}
                  </span>
                </>
                )
              }}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
