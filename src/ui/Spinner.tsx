import { useTranslation } from 'react-i18next'

/**
 * The busy indicator.
 *
 * It announces itself by default. A spinner that is only a picture leaves a screen-reader user
 * with a silent screen and no way to tell "loading" from "empty" — and this app shows plenty of
 * legitimately empty screens. Pass `label={null}` for the one case where that is wrong: a
 * spinner INSIDE a control that is already `aria-busy`, where the announcement is a duplicate.
 */

export interface SpinnerProps {
  size?: number
  /** Announced text. `null` makes it decorative; omitted uses "Loading…". */
  label?: string | null
  className?: string
}

export function Spinner({ size = 20, label, className }: SpinnerProps) {
  const { t } = useTranslation()
  const decorative = label === null
  const text = label ?? t('common.loading')

  const svg = (
    <svg
      className={`th-spinner ${className ?? ''}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* The track carries the arc's own colour at low opacity rather than a token of its own,
          so the spinner inherits whatever it is placed on — including the accent fill of a
          primary button, where a fixed grey track would read as a smudge. */}
      <circle cx="12" cy="12" r="9" opacity={0.22} />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  )

  if (decorative) return svg

  return (
    <span role="status" style={{ display: 'inline-flex', alignItems: 'center' }}>
      {svg}
      <span className="sr-only">{text}</span>
    </span>
  )
}
