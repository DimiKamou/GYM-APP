import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Icon } from '@/ui/Icon'

/**
 * − value + for a small bounded count: rest seconds, an RPE, a set's reps when the keypad is
 * overkill.
 *
 * Three things are deliberate:
 *
 *  - **The value is a `spinbutton`.** It is focusable and takes ArrowUp / ArrowDown / PageUp /
 *    PageDown / Home / End, so the control works without ever hitting either button. Two
 *    buttons around a `<span>` is a control a keyboard cannot reach the middle of.
 *  - **Tabular numerals** (`.num`). 9 → 10 must not shift the buttons sideways under a thumb
 *    that is already moving toward one of them.
 *  - **No destructive slot.** A stepper never renders a delete, and a caller must not place one
 *    against its `+` edge: "one more rep" and "throw the set away" a thumb's width apart is the
 *    mistake this rule exists to prevent. Removal belongs in `<SwipeRow>`, on the other axis.
 */

export interface StepperProps {
  value: number
  onChange: (next: number) => void
  step?: number
  min?: number
  max?: number
  /** Names the whole control. Already translated — "Reps", "Rest". */
  label: string
  /** Rendering of the value. Use `formatWeight`/`formatSet` so Greek gets its comma. */
  format?: (value: number) => string
  /** A coarser jump for PageUp / PageDown. Defaults to five steps. */
  pageStep?: number
  disabled?: boolean
  className?: string
}

export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 999,
  label,
  format,
  pageStep,
  disabled = false,
  className,
}: StepperProps) {
  const { t } = useTranslation()
  const coarse = pageStep ?? step * 5

  function clamp(next: number): number {
    // Rounded to the step's own precision: 2.5 + 2.5 in floating point is fine, but 0.1 + 0.2
    // is not, and a rest timer that reads "17.500000000000004" has lost the trainer.
    const rounded = Math.round(next * 1000) / 1000
    return Math.min(max, Math.max(min, rounded))
  }

  function nudge(delta: number) {
    if (disabled) return
    const next = clamp(value + delta)
    if (next !== value) onChange(next)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        event.preventDefault()
        nudge(step)
        break
      case 'ArrowDown':
      case 'ArrowLeft':
        event.preventDefault()
        nudge(-step)
        break
      case 'PageUp':
        event.preventDefault()
        nudge(coarse)
        break
      case 'PageDown':
        event.preventDefault()
        nudge(-coarse)
        break
      case 'Home':
        event.preventDefault()
        if (value !== min) onChange(min)
        break
      case 'End':
        event.preventDefault()
        if (value !== max) onChange(max)
        break
      default:
        break
    }
  }

  const text = format ? format(value) : String(value)
  const amount = format ? format(step) : String(step)

  return (
    <div className={`th-stepper ${className ?? ''}`.trim()}>
      <button
        type="button"
        className="th-tap th-stepper__btn"
        onClick={() => nudge(-step)}
        disabled={disabled || value <= min}
        aria-label={t('ui.decreaseBy', { amount })}
      >
        <Icon name="minus" size={20} strokeWidth={2.2} />
      </button>

      <div
        className="th-stepper__value num"
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        // The raw number is what `aria-valuenow` carries; this is what gets SPOKEN, and it has
        // to be the same string the trainer is looking at, comma and all.
        aria-valuetext={text}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
      >
        {text}
      </div>

      <button
        type="button"
        className="th-tap th-stepper__btn"
        onClick={() => nudge(step)}
        disabled={disabled || value >= max}
        aria-label={t('ui.increaseBy', { amount })}
      >
        <Icon name="plus" size={20} strokeWidth={2.2} />
      </button>
    </div>
  )
}
