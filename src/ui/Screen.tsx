import type { CSSProperties, ReactNode } from 'react'

/**
 * The scroll container every screen sits in.
 *
 * One scrolling element per screen, and it is this one. A screen that scrolls the document
 * instead loses its header the moment iOS rubber-bands, and a trainer thumbing through forty
 * sets is rubber-banding constantly.
 *
 * Safe areas: this owns the top and side insets. It deliberately does NOT add
 * `env(safe-area-inset-bottom)` — whatever is docked at the bottom of the frame owns that, and
 * on the tabbed routes that is `<TabBar>`. Adding it in both places puts a second home-indicator
 * gap above the tab bar on every list.
 */

export interface ScreenProps {
  children: ReactNode
  /**
   * Fixed above the scrolling body — a title row, a search field, a back button. Kept out of
   * the scroller so the athlete's name stays on screen while their history moves under it.
   */
  header?: ReactNode
  /** Names the scroll region for assistive tech. Pass the screen's own title. */
  label?: string
  /** Extra styles for the scrolling body, for a screen that needs its own gap or padding. */
  bodyStyle?: CSSProperties
}

const frame: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
}

const sidePadding: CSSProperties = {
  paddingLeft: 'calc(var(--th-screen-pad) + env(safe-area-inset-left, 0px))',
  paddingRight: 'calc(var(--th-screen-pad) + env(safe-area-inset-right, 0px))',
}

/** The top inset lands on whichever element is first — the header if there is one, else the body. */
const topInset = 'calc(var(--th-pad) + env(safe-area-inset-top, 0px))'

const headerStyle: CSSProperties = {
  ...sidePadding,
  flex: '0 0 auto',
  paddingTop: topInset,
  paddingBottom: 'var(--th-gap)',
}

const bodyBase: CSSProperties = {
  ...sidePadding,
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  // Momentum scrolling in an installed iOS PWA; without it the list stops dead on release.
  WebkitOverflowScrolling: 'touch',
  paddingBottom: 'var(--th-screen-pad)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--th-gap)',
}

export function Screen({ children, header, label, bodyStyle }: ScreenProps) {
  return (
    <div style={frame}>
      {header ? <div style={headerStyle}>{header}</div> : null}
      <div
        style={{ ...bodyBase, paddingTop: header ? 0 : topInset, ...bodyStyle }}
        aria-label={label}
        role={label ? 'region' : undefined}
      >
        {children}
      </div>
    </div>
  )
}
