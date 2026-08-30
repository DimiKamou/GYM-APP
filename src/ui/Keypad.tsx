import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { parseDecimal } from '@/domain/parseDecimal'
import { Icon } from '@/ui/Icon'

/**
 * The numeric pad. The one control this app lives or dies on.
 *
 * A set is logged mid-workout, one-handed, with the other hand on the bar or on the athlete.
 * That premise decides everything here:
 *
 *  - **It is not an `<input>`, and it never will be.** A focused input raises the OS keyboard
 *    over the bottom half of the screen — exactly the half a thumb can reach — leaving the set
 *    row it is editing hidden behind it. It also hands over key layout: the Greek keyboard's
 *    decimal key emits a COMMA, and `Number("72,5")` is `NaN`. The prototype did precisely that
 *    and the NaN went into every volume total downstream. Nothing here can raise a keyboard,
 *    and every value leaves through `parseDecimal`.
 *  - **The comma is a first-class key**, in the position a Greek trainer's thumb expects. It is
 *    not a "locale-aware separator"; it is the character these users type.
 *  - **Everything tappable is in the lower half.** The readout is the only thing above the pad,
 *    and it is the only thing nobody touches. Chips, keys and the commit bar are all below it.
 *  - **Recent loads carry their provenance.** A chip is a coaching number, and a coaching
 *    number without a date and an author is what gets loaded onto a bar by mistake — so
 *    `meta` is required, not optional. "80 · 12 Αυγ · Μαρία", never a bare "80".
 *
 * Layout is a 4×4 grid: three digit columns, a fourth column of backspace and the fine nudge,
 * and a bottom row carrying the comma, the zero and the coarse nudge. The nudges are ±2.5 and
 * ±5 by default because those are the plates, not because they are round numbers.
 */

/** One recent load, with the date and author that make it safe to act on. */
export interface KeypadSuggestion {
  value: number
  /** The number as the trainer reads it — run it through `formatWeight`/`formatSet`. */
  label: string
  /** "12 Αυγ · Μαρία". Required: see the rule above. */
  meta: string
}

export interface KeypadProps {
  /** What is being entered — "Κιλά", "Επαν.". Already translated. */
  label: string
  /** Optional trailing unit in the readout. */
  unit?: string
  /** Controlled raw text. Omit to let the pad hold its own. */
  value?: string
  defaultValue?: string
  onValueChange?: (raw: string) => void
  /** Fires only with a value `parseDecimal` accepted and the range allowed. */
  onCommit: (value: number) => void
  /** Escape, or a tap outside the pad. Omit and the pad has no way out but committing. */
  onClose?: () => void
  /** This athlete's recent loads on this exercise. Rendered as one-tap chips. */
  suggestions?: ReadonlyArray<KeypadSuggestion>
  /** The two nudge sizes, fine first. Reps want `[1, 5]`. */
  nudges?: readonly [number, number]
  min?: number
  max?: number
  /** Reps and seconds. Disables the comma key and rejects a fractional commit. */
  integer?: boolean
  /** Already translated. Defaults to "Καταχώριση". */
  commitLabel?: string
  className?: string
}

const DEFAULT_NUDGES: readonly [number, number] = [2.5, 5]
/** "1000,5" is the longest real entry; past that it is a leaning thumb, not a number. */
const MAX_DIGITS = 6

/**
 * A number back into the pad's own text. The separator is a comma because that is what the pad
 * emits and what the trainer typed — going out through `Intl` here would round-trip a nudged
 * value into a shape the pad's own keys could not have produced.
 */
function toRaw(value: number): string {
  return String(Math.round(value * 1000) / 1000).replace('.', ',')
}

function digitCount(raw: string): number {
  return raw.replace(/[^0-9]/g, '').length
}

export function Keypad({
  label,
  unit,
  value,
  defaultValue = '',
  onValueChange,
  onCommit,
  onClose,
  suggestions,
  nudges = DEFAULT_NUDGES,
  min = 0,
  max = 1000,
  integer = false,
  commitLabel,
  className,
}: KeypadProps) {
  const { t } = useTranslation()
  const [internal, setInternal] = useState(defaultValue)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const controlled = value !== undefined
  const raw = controlled ? value : internal

  const setRaw = useCallback(
    (next: string) => {
      setError(null)
      if (!controlled) setInternal(next)
      onValueChange?.(next)
    },
    [controlled, onValueChange],
  )

  const commit = useCallback(() => {
    const parsed = parseDecimal(raw, { min, max })
    if (parsed === null || (integer && !Number.isInteger(parsed))) {
      // Refused, not clamped and not silently zeroed. A wrong number that reaches storage is
      // the failure this whole component exists to prevent.
      setError(t('ui.invalidNumber'))
      return
    }
    onCommit(parsed)
  }, [raw, min, max, integer, onCommit, t])

  const press = useCallback(
    (key: string) => {
      if (key === ',') {
        if (integer || raw.includes(',')) return
        setRaw(raw === '' ? '0,' : `${raw},`)
        return
      }
      if (digitCount(raw) >= MAX_DIGITS) return
      // A leading zero is replaced rather than appended: "0" then "8" is 8, never "08".
      setRaw(raw === '0' ? key : raw + key)
    },
    [raw, integer, setRaw],
  )

  const backspace = useCallback(() => setRaw(raw.slice(0, -1)), [raw, setRaw])

  const nudge = useCallback(
    (delta: number) => {
      // An unparseable box nudges from zero rather than refusing: the trainer's intent when
      // they hit "+5" on an empty pad is unambiguous.
      const current = parseDecimal(raw, { min, max }) ?? 0
      const next = Math.min(max, Math.max(min, Math.round((current + delta) * 1000) / 1000))
      setRaw(toRaw(next))
    },
    [raw, min, max, setRaw],
  )

  /**
   * A hardware keyboard — the owner doing admin on a laptop — types into the pad without it
   * ever taking focus. Listening on the document rather than on a focused container is what
   * keeps that true; anything already typing into a real field is left alone.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement)
      ) {
        return
      }

      if (event.key >= '0' && event.key <= '9') {
        event.preventDefault()
        press(event.key)
      } else if (event.key === ',' || event.key === '.') {
        event.preventDefault()
        press(',')
      } else if (event.key === 'Backspace') {
        event.preventDefault()
        backspace()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        commit()
      } else if (event.key === 'Escape' && onClose) {
        event.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [press, backspace, commit, onClose])

  // A tap on the screen behind the pad puts it away. Without this the only exit is committing,
  // and a pad opened by a mis-tap would trap the trainer into entering a set they did not do.
  useEffect(() => {
    if (!onClose) return
    function onOutside(event: globalThis.PointerEvent) {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      onClose?.()
    }
    document.addEventListener('pointerdown', onOutside)
    return () => document.removeEventListener('pointerdown', onOutside)
  }, [onClose])

  const [fine, coarse] = nudges
  const empty = raw === ''

  function digit(key: string) {
    return (
      <button
        key={key}
        type="button"
        className="th-key num"
        onClick={() => press(key)}
        aria-label={t('ui.digit', { digit: key })}
      >
        {key}
      </button>
    )
  }

  function nudgeKey(delta: number) {
    const amount = toRaw(Math.abs(delta))
    return (
      <button
        type="button"
        className="th-key th-key--nudge num"
        onClick={() => nudge(delta)}
        aria-label={t(delta < 0 ? 'ui.decreaseBy' : 'ui.increaseBy', { amount })}
      >
        {delta < 0 ? '−' : '+'}
        {amount}
      </button>
    )
  }

  return (
    <div
      ref={rootRef}
      className={`th-keypad ${className ?? ''}`.trim()}
      role="group"
      aria-label={`${t('ui.keypad')} — ${label}`}
    >
      <div className="th-keypad__display">
        <span className={`th-keypad__value num ${empty ? 'th-keypad__value--empty' : ''}`.trim()}>
          {/* Announced on change so a screen-reader user hears the number growing; the keys
              themselves only say which digit was pressed, not what the value now is. */}
          <span aria-live="polite">{empty ? t('ui.noValue') : raw}</span>
          {!empty && unit ? <span className="th-keypad__label"> {unit}</span> : null}
        </span>
        {error ? <span className="th-keypad__error">{error}</span> : <span className="th-keypad__label">{label}</span>}
      </div>

      {suggestions && suggestions.length > 0 ? (
        <div className="th-keypad__chips" role="group" aria-label={t('ui.recentLoads')}>
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.value}-${index}`}
              type="button"
              className="th-keypad__chip"
              onClick={() => setRaw(toRaw(suggestion.value))}
              aria-label={`${suggestion.label} · ${suggestion.meta}`}
            >
              <span className="th-keypad__chipValue num">{suggestion.label}</span>
              <span className="th-keypad__chipMeta">{suggestion.meta}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="th-keypad__grid">
        {digit('7')}
        {digit('8')}
        {digit('9')}
        <button
          type="button"
          className="th-key th-key--erase"
          onClick={backspace}
          aria-label={t('ui.backspace')}
        >
          <Icon name="back" size={22} strokeWidth={2} />
        </button>

        {digit('4')}
        {digit('5')}
        {digit('6')}
        {nudgeKey(-fine)}

        {digit('1')}
        {digit('2')}
        {digit('3')}
        {nudgeKey(fine)}

        <button
          type="button"
          className="th-key num"
          onClick={() => press(',')}
          disabled={integer}
          aria-label={t('ui.decimalComma')}
        >
          ,
        </button>
        {digit('0')}
        {nudgeKey(-coarse)}
        {nudgeKey(coarse)}
      </div>

      <button
        type="button"
        className="th-key th-key--commit"
        onClick={commit}
        // `aria-disabled`, not `disabled`: an empty pad's commit key stays focusable and stays
        // announced, so pressing it says why nothing happened instead of silently doing nothing.
        aria-disabled={empty || undefined}
      >
        <Icon name="check" size={20} strokeWidth={2.2} />
        {commitLabel ?? t('ui.commit')}
      </button>
    </div>
  )
}
