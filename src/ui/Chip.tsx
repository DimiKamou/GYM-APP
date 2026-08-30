import type { ReactNode } from 'react'

import { Icon, type IconName } from '@/ui/Icon'

/**
 * A pill. Two jobs, and the DOM differs between them:
 *
 *  - a LABEL (`onClick` omitted) is a `<span>` and needs no hit target;
 *  - a FILTER (`onClick` given) is a `<button>` with `aria-pressed`, and takes the 44px floor.
 *
 * `aria-pressed` rather than `aria-selected`: a filter chip is a toggle that stays where it is,
 * not a choice inside a listbox, and the two are announced differently.
 */

export interface ChipProps {
  children: ReactNode
  icon?: IconName
  /** Only meaningful on a tappable chip. Drives the fill and `aria-pressed`. */
  selected?: boolean
  onClick?: () => void
  /** Supply when the visible text is an abbreviation ("ΕΛ" for "Ελληνικά"). */
  ariaLabel?: string
  className?: string
}

export function Chip({ children, icon, selected, onClick, ariaLabel, className }: ChipProps) {
  const classes = [
    'th-chip',
    onClick ? 'th-chip--tappable' : '',
    selected ? 'th-chip--selected' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      {icon ? <Icon name={icon} size={15} strokeWidth={2} /> : null}
      {children}
    </>
  )

  if (!onClick) {
    return (
      <span className={classes} aria-label={ariaLabel}>
        {content}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-pressed={selected ?? false}
      aria-label={ariaLabel}
    >
      {content}
    </button>
  )
}
