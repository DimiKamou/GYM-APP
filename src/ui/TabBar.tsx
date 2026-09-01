import { useCallback, useSyncExternalStore, type CSSProperties } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Icon, type IconName } from '@/ui/Icon'
import type { TranslationKey } from '@/i18n'

/**
 * The five tabs.
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
}

const TABS: readonly Tab[] = [
  { to: '/athletes', icon: 'athletes', label: 'nav.athletes' },
  { to: '/calendar', icon: 'calendar', label: 'nav.calendar' },
  { to: '/library', icon: 'library', label: 'nav.library' },
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
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '0.02em',
  textAlign: 'center',
}

export function TabBar() {
  const { t } = useTranslation()
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

  const style = useCallback(
    ({ isActive }: { isActive: boolean }): CSSProperties => ({
      ...linkBase,
      color: isActive ? 'var(--th-accent)' : 'var(--th-faint)',
      background: isActive ? 'var(--th-surface-2)' : 'transparent',
    }),
    [],
  )

  return (
    <nav aria-label={t('nav.primary')} style={navStyle}>
      <ul style={{ display: 'flex', alignItems: 'stretch' }}>
        {TABS.map((tab) => (
          <li key={tab.to} style={{ flex: 1, minWidth: 0 }}>
            {/* NavLink stamps aria-current="page" on the active link itself, which is the one
                thing a screen reader needs to say "you are here" without a visual cue. */}
            <NavLink to={tab.to} style={style} className="hit">
              {({ isActive }) => (
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
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
