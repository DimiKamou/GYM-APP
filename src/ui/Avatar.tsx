import type { CSSProperties } from 'react'

import { initials } from '@/domain/text'

/**
 * Initials in a circle.
 *
 * Monochrome on purpose (see `--th-avatar-bg` / `--th-avatar-ink`): identity here is the name,
 * and a per-person colour would be a second identity system that disagrees with the first one
 * every time two athletes share a hue.
 *
 * `initials()` strips diacritics before uppercasing, so "Άννα Παπαδάκη" is "ΑΠ" and not "ΆΠ" —
 * Greek capitals are written without accents.
 *
 * Hidden from assistive tech by default. The avatar is decoration next to a name that is
 * already in the DOM; announcing "Α Π" before it just makes the row take twice as long to read.
 */

export interface AvatarProps {
  fullName: string
  size?: number
  className?: string
  style?: CSSProperties
  /**
   * Set when the avatar stands alone with no name beside it — a coach chip in a dense calendar
   * cell. Then it is announced instead of hidden.
   */
  label?: string
}

export function Avatar({ fullName, size = 44, className, style, label }: AvatarProps) {
  const text = initials(fullName)

  return (
    <span
      className={`th-avatar ${className ?? ''}`.trim()}
      style={{
        width: size,
        height: size,
        // The glyphs stay optically constant across sizes; a fixed font-size would look
        // cramped at 64 and clipped at 28.
        fontSize: Math.round(size * 0.38),
        ...style,
      }}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {text}
    </span>
  )
}
