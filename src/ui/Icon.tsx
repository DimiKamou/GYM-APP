/**
 * The icon set — inline SVG, stroke-based, `currentColor`.
 *
 * No icon library. A few dozen glyphs do not justify a dependency that ships hundreds, and the
 * tab bar's icons have to be reachable offline before the first paint, so they belong in the
 * bundle rather than behind a font or a sprite request.
 *
 * Every icon is `aria-hidden`: an icon in this app is always inside a control that already
 * carries a text label or an `aria-label`, so announcing it again just says everything twice.
 *
 * Two pairs are deliberately near-synonyms rather than aliases — `athletes`/`users` and
 * `team`/`users`. A screen asks for the glyph by what it MEANS there ("the roster", "the people
 * on this appointment"), and collapsing them would mean a later change to the roster glyph
 * silently redrew the appointment one too.
 */

import type { ReactElement } from 'react'

export type IconName =
  // navigation
  | 'athletes'
  | 'calendar'
  | 'library'
  | 'team'
  | 'settings'
  | 'back'
  | 'chevron'
  // actions
  | 'plus'
  | 'minus'
  | 'search'
  | 'check'
  | 'x'
  | 'trash'
  | 'edit'
  | 'undo'
  | 'copy'
  | 'share'
  | 'download'
  // objects and states
  | 'clock'
  | 'timer'
  | 'users'
  | 'dumbbell'
  | 'note'
  | 'pin'
  | 'alert'
  | 'offline'
  | 'sparkle'

export interface IconProps {
  name: IconName
  /** Rendered pixel box. The 24-unit viewBox scales to it. */
  size?: number
  /** Thicker on the active tab — the calm directions carry weight, not fill, as emphasis. */
  strokeWidth?: number
  className?: string
}

// One 24×24 viewBox, no fills, round joins. Ported from the design prototype's `ic` map and
// extended for the nine screens.
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
  chevron: <path d="M9 6l6 6-6 6" />,

  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.2-3.2" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5 10-11" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4A1.3 1.3 0 0 1 14.5 4.8V7" />
      <path d="M6.5 7l.9 12.2A1.6 1.6 0 0 0 9 20.5h6a1.6 1.6 0 0 0 1.6-1.3L17.5 7" />
      <path d="M10.5 11v6M13.5 11v6" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20l.9-3.6L15.3 6a2 2 0 0 1 2.8 0l0 0a2 2 0 0 1 0 2.8L7.6 19.1z" />
      <path d="M14 7.3l2.7 2.7" />
    </>
  ),
  undo: (
    <>
      <path d="M4 9h9.5a5.5 5.5 0 0 1 0 11H8" />
      <path d="M7.5 5L3.5 9l4 4" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.2" />
      <path d="M15 6.2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.2" />
    </>
  ),
  share: (
    <>
      <path d="M12 3.5v12" />
      <path d="M8 7.5l4-4 4 4" />
      <path d="M6 12.5H5a1.5 1.5 0 0 0-1.5 1.5v5.5A1.5 1.5 0 0 0 5 21h14a1.5 1.5 0 0 0 1.5-1.5V14a1.5 1.5 0 0 0-1.5-1.5h-1" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11.5" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4 17.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-1.5" />
    </>
  ),

  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.2 2" />
    </>
  ),
  // The rest timer, distinguished from `clock` by the stopwatch crown — the two appear side by
  // side in the Log header and must not read as the same control.
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M9.5 2.8h5M12 2.8v2.2M17.8 7.2l1.7-1.7" />
      <path d="M12 9.5v4" />
    </>
  ),
  users: (
    <>
      <circle cx="10" cy="8" r="3" />
      <path d="M3.8 19.5c0-3 2.7-4.8 6.2-4.8s6.2 1.8 6.2 4.8" />
      <path d="M17 7.2a2.8 2.8 0 0 1 0 5.4M18.6 14.6c1.8.6 3 2 3 4" />
    </>
  ),
  dumbbell: (
    <>
      <path d="M3.5 9.5v5M6.5 7v10M17.5 7v10M20.5 9.5v5" />
      <path d="M6.5 12h11" />
    </>
  ),
  note: (
    <>
      <path d="M5.5 4.5h9L19 9v10.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1z" />
      <path d="M14 4.5V9h5M8 13h7M8 16.5h5" />
    </>
  ),
  pin: (
    <>
      <path d="M9 3.5h6l-1 5.5 3 3.2v1.3H7v-1.3l3-3.2z" />
      <path d="M12 13.5v7" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.2l8.2 14.3a1 1 0 0 1-.9 1.5H4.7a1 1 0 0 1-.9-1.5z" />
      <path d="M12 10v4" />
      <path d="M12 17.2v.1" />
    </>
  ),
  // Not a crossed-out cloud: the state is "this write is waiting", and the queue is what a
  // trainer needs to recognise at a glance.
  offline: (
    <>
      <path d="M6.5 16.5a3.5 3.5 0 0 1 .4-7A5.2 5.2 0 0 1 16.6 8a3.9 3.9 0 0 1 2.6 6.6" />
      <path d="M3.5 20.5l17-17" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8z" />
      <path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </>
  ),
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

/** Every glyph, for the icon audit in `ui.test.tsx`. */
export const ICON_NAMES = Object.keys(PATHS) as readonly IconName[]
