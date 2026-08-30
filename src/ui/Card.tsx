import type { CSSProperties, ReactNode } from 'react'

/**
 * The surface every screen is built out of.
 *
 * Two shapes, and the difference is structural, not decorative: with `onClick` the whole card
 * becomes a single `<button>`, which is how an athlete row is one 72px-tall target instead of a
 * name-sized link a thumb misses. Without it, it is a plain `<div>`.
 *
 * An interactive Card must not contain another control. Nested buttons are invalid HTML and
 * collapse in Safari to whichever one the browser feels like dispatching. A row that needs a
 * card-wide tap AND a per-row delete is a `<SwipeRow>` wrapping a non-interactive Card.
 */

export interface CardProps {
  children: ReactNode
  /** `flat` drops the border and sits on the tinted surface — for a card inside a card. */
  tone?: 'surface' | 'flat'
  raised?: boolean
  /** Removes the padding, for a card whose children own their own edges (a list of rows). */
  tight?: boolean
  className?: string
  style?: CSSProperties
  /** Turns the card into one button. Mutually exclusive with any control inside it. */
  onClick?: () => void
  /** Only meaningful with `onClick`; supply it when the card's text is not its whole name. */
  ariaLabel?: string
}

function classes(props: CardProps, interactive: boolean): string {
  return [
    'th-card',
    props.tone === 'flat' ? 'th-card--flat' : '',
    props.raised ? 'th-card--raised' : '',
    props.tight ? 'th-card--tight' : '',
    interactive ? 'th-card--interactive' : '',
    props.className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function Card(props: CardProps) {
  const { children, style, onClick, ariaLabel } = props

  if (onClick) {
    return (
      <button
        type="button"
        className={classes(props, true)}
        style={style}
        onClick={onClick}
        aria-label={ariaLabel}
      >
        {children}
      </button>
    )
  }

  return (
    <div className={classes(props, false)} style={style}>
      {children}
    </div>
  )
}
