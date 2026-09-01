import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

import { Icon, type IconName } from '@/ui/Icon'
import { Spinner } from '@/ui/Spinner'

/**
 * The one button.
 *
 * `type="button"` is the default rather than `submit`. Almost every button in this app sits
 * inside a form-shaped card that is not a `<form>`, and the one place the default matters — a
 * sign-in form where Enter must submit — is the place that will say `type="submit"` explicitly.
 *
 * There is no size below 44px. `size="sm"` shrinks the type and the padding and keeps the
 * target, because "small" here is a visual weight, never a smaller thing to hit with a thumb
 * while talking to the athlete in front of you.
 */

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'quiet'
  | 'ghost'
  /** Solid destructive. Never place it adjacent to the routine action it can be mistaken for. */
  | 'danger'
  | 'dangerQuiet'

export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'th-btn--primary',
  secondary: 'th-btn--secondary',
  quiet: 'th-btn--quiet',
  ghost: 'th-btn--ghost',
  danger: 'th-btn--danger',
  dangerQuiet: 'th-btn--danger-quiet',
}

interface ButtonBaseProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Fills its container. The primary action of a sheet or a card footer.  */
  block?: boolean
  icon?: IconName
  trailingIcon?: IconName
  /** Swaps the leading icon for a spinner and marks the control busy. */
  loading?: boolean
}

/**
 * An icon with no text has no accessible name unless one is supplied, and a control a screen
 * reader announces as "button" is unusable. The type makes that a compile error rather than an
 * audit finding: no children means `aria-label` is required.
 */
type ButtonLabelling =
  | { children: ReactNode }
  | { children?: undefined; 'aria-label': string }

export type ButtonProps = ButtonBaseProps & ButtonLabelling

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    block = false,
    icon,
    trailingIcon,
    loading = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const iconOnly = children === undefined || children === null || children === false
  const classes = [
    'th-tap',
    'th-btn',
    `th-btn--${size}`,
    VARIANT_CLASS[variant],
    block ? 'th-btn--block' : '',
    iconOnly ? 'th-btn--icon' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const glyphSize = size === 'lg' ? 22 : size === 'sm' ? 18 : 20

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <Spinner size={glyphSize} label={null} />
      ) : icon ? (
        <Icon name={icon} size={glyphSize} strokeWidth={1.9} />
      ) : null}
      {children}
      {trailingIcon && !iconOnly ? (
        <Icon name={trailingIcon} size={glyphSize} strokeWidth={1.9} />
      ) : null}
    </button>
  )
})
