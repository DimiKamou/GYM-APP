import { useRef, type KeyboardEvent } from 'react'

import { Icon, type IconName } from '@/ui/Icon'

/**
 * A small set of mutually exclusive choices — theme, locale, "week / month", set kind.
 *
 * Built as a radio group rather than a tab list. Tabs promise that something below them swaps;
 * these mostly change a filter in place, and a screen reader that announces "tab" invites the
 * user to look for a panel that is not there.
 *
 * Roving tabindex: the group is ONE tab stop and the arrows move within it. Five segments that
 * each take a tab stop is five presses to get past a theme picker.
 */

export interface SegmentedOption<T extends string> {
  value: T
  /** Already translated. */
  label: string
  icon?: IconName
}

export interface SegmentedProps<T extends string> {
  /** Names the group for assistive tech. Already translated. */
  label: string
  value: T
  options: ReadonlyArray<SegmentedOption<T>>
  onChange: (value: T) => void
  className?: string
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null)
  // A group whose value matches nothing (a filter cleared elsewhere) would otherwise have no
  // tab stop at all and become unreachable by keyboard.
  const selectedIndex = options.findIndex((option) => option.value === value)

  function move(delta: number, from: number) {
    if (options.length === 0) return
    const next = (from + delta + options.length) % options.length
    const option = options[next]
    onChange(option.value)
    // Selection follows focus in a radio group, so the focus has to follow it back.
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    buttons?.[next]?.focus()
  }

  // The handler is bound to the option buttons, not the radiogroup div — roving tabindex means
  // the focused element is always one of the buttons, so the event is theirs.
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        move(1, index)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        move(-1, index)
        break
      case 'Home':
        event.preventDefault()
        move(-index, index)
        break
      case 'End':
        event.preventDefault()
        move(options.length - 1 - index, index)
        break
      default:
        break
    }
  }

  return (
    <div
      ref={groupRef}
      className={`th-seg ${className ?? ''}`.trim()}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option, index) => {
        const checked = option.value === value
        const focusable = checked || (selectedIndex === -1 && index === 0)
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={focusable ? 0 : -1}
            className="th-seg__item"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.icon ? <Icon name={option.icon} size={16} strokeWidth={2} /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
