/**
 * The icon set — inline SVG, stroke-based, `currentColor`.
 *
 * No icon library. Nine glyphs do not justify a dependency that ships hundreds, and the tab
 * bar's icons have to be reachable offline before the first paint, so they belong in the
 * bundle rather than behind a font or a sprite request.
 *
 * Every icon is `aria-hidden`: an icon in this app is always inside a control that already
 * carries a text label or an `aria-label`, so announcing it again just says everything twice.
 */

import type { ReactElement } from 'react'

export type IconName =
  | 'athletes'
  | 'calendar'
  | 'library'
  | 'team'
  | 'settings'
  | 'back'
  | 'plus'
  | 'search'
  | 'chevron'

export interface IconProps {
  name: IconName
  /** Rendered pixel box. The 24-unit viewBox scales to it. */
  size?: number
  /** Thicker on the active tab — the calm directions carry weight, not fill, as emphasis. */
  strokeWidth?: number
  className?: string
}

// Ported from the design prototype's `ic` map: one 24×24 viewBox, no fills, round joins.
const PATHS: Record<IconName, ReactElement> = {
  athletes: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3.2 2.5-5 5.5-5s5.5 1.8 5.5 5" />
      <path d="M16 6.5a3 3 0 0 1 0 5.6M17.5 14c2 .6 3.5 2.2 3.5 4.6" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="15" rx="2.5" />
      <path d="M4 10h16M8 3.5v4M16 3.5v4" />
    </>
  ),
  library: (
    <>
      <rect x="5" y="4" width="5" height="16" rx="1.4" />
      <rect x="13" y="4" width="6" height="16" rx="1.4" />
    </>
  ),
  team: (
    <>
      <circle cx="8" cy="9" r="2.6" />
      <circle cx="16" cy="9" r="2.6" />
      <path d="M3.5 19c0-2.6 2-4 4.5-4M16 15c2.5 0 4.5 1.4 4.5 4" />
    </>
  ),
  settings: (
    <>
      <path d="M5 8h14M5 16h14" />
      <circle cx="9" cy="8" r="2.1" />
      <circle cx="15" cy="16" r="2.1" />
    </>
  ),
  back: <path d="M15 6l-6 6 6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.2-3.2" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
}

export function Icon({ name, size = 22, strokeWidth = 1.7, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
