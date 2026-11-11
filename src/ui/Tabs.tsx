import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { useSearchParams } from 'react-router-dom'

import { Icon, type IconName } from '@/ui/Icon'

/**
 * In-screen tabs: a sticky strip with a sliding orange indicator, panels that slide in from the
 * side they were asked from, and a horizontal swipe that walks between them.
 *
 * The open tab lives in the address (`?tab=`), replaced rather than pushed: back from a workout
 * opened on "Ιστορικό" lands on "Ιστορικό", and switching tabs never fills the back stack — the
 * system back gesture leaves the screen, as on every other screen in the app.
 *
 * Only the open panel is mounted. A tab of charts that nobody opened costs nothing.
 */

export interface TabDef<T extends string> {
  id: T
  label: string
  icon?: IconName
  /** A small count beside the label (unread notes, records this month). Hidden at 0. */
  badge?: number
}

export function useTabParam<T extends string>(ids: readonly T[], fallback: T): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const value = ids.includes(raw as T) ? (raw as T) : fallback
  const set = useCallback(
    (next: T) => {
      setParams(
        (current) => {
          const copy = new URLSearchParams(current)
          if (next === fallback) copy.delete('tab')
          else copy.set('tab', next)
          return copy
        },
        { replace: true, preventScrollReset: true },
      )
    },
    [setParams, fallback],
  )
  return [value, set]
}

export interface TabsProps<T extends string> {
  tabs: readonly TabDef<T>[]
  value: T
  onChange: (next: T) => void
  /** Names the tablist for assistive tech. */
  label: string
  children: (id: T) => ReactNode
}

const SWIPE_MIN_PX = 64

/** A gesture that starts on something that scrolls or swipes sideways belongs to that thing. */
function ownsHorizontalGesture(target: EventTarget | null, boundary: HTMLElement): boolean {
  let el = target instanceof Element ? target : null
  while (el && el !== boundary) {
    if (el.matches('input, textarea, select, .th-swipe, [data-no-tab-swipe]')) return true
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 2) {
      const overflow = getComputedStyle(el).overflowX
      if (overflow === 'auto' || overflow === 'scroll') return true
    }
    el = el.parentElement
  }
  return false
}

export function Tabs<T extends string>({ tabs, value, onChange, label, children }: TabsProps<T>) {
  const base = useId()
  const stripRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<T, HTMLButtonElement>())
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null)
  const index = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === value),
  )
  const previous = useRef(index)
  const direction = index >= previous.current ? 'next' : 'prev'
  useEffect(() => {
    previous.current = index
  }, [index])

  const measure = useCallback(() => {
    const button = buttons.current.get(value)
    if (!button) return
    setIndicator({ x: button.offsetLeft, w: button.offsetWidth })
  }, [value])

  useLayoutEffect(() => {
    measure()
    const button = buttons.current.get(value)
    // jsdom has no scrollIntoView, and a strip that already fits needs none.
    if (button && typeof button.scrollIntoView === 'function') {
      button.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
    }
  }, [measure, value])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !stripRef.current) return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(stripRef.current)
    return () => observer.disconnect()
  }, [measure])

  function go(delta: number, focus: boolean) {
    const next = tabs[(index + delta + tabs.length) % tabs.length]
    if (!next) return
    onChange(next.id)
    if (focus) buttons.current.get(next.id)?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowRight') go(1, true)
    else if (event.key === 'ArrowLeft') go(-1, true)
    else if (event.key === 'Home') {
      onChange(tabs[0].id)
      buttons.current.get(tabs[0].id)?.focus()
    } else if (event.key === 'End') {
      const last = tabs[tabs.length - 1]
      onChange(last.id)
      buttons.current.get(last.id)?.focus()
    } else return
    event.preventDefault()
  }

  const start = useRef<{ x: number; y: number; t: number } | null>(null)
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' || !panelRef.current) return
    start.current = ownsHorizontalGesture(event.target, panelRef.current)
      ? null
      : { x: event.clientX, y: event.clientY, t: Date.now() }
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const from = start.current
    start.current = null
    if (!from) return
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    // A deliberate sideways flick, not the end of a vertical scroll that drifted.
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - from.t > 700) return
    if (dx < 0 && index < tabs.length - 1) onChange(tabs[index + 1].id)
    if (dx > 0 && index > 0) onChange(tabs[index - 1].id)
  }

  return (
    <>
      <div className="th-tabs">
        <div ref={stripRef} role="tablist" aria-label={label} className="th-tabs__strip">
          {tabs.map((tab) => {
            const selected = tab.id === value
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  if (el) buttons.current.set(tab.id, el)
                  else buttons.current.delete(tab.id)
                }}
                type="button"
                role="tab"
                id={`${base}-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`${base}-panel`}
                tabIndex={selected ? 0 : -1}
                className="th-tabs__tab"
                onClick={() => onChange(tab.id)}
                onKeyDown={onKeyDown}
              >
                {tab.icon ? <Icon name={tab.icon} size={17} strokeWidth={selected ? 2.2 : 1.7} /> : null}
                <span>{tab.label}</span>
                {tab.badge ? <span className="th-tabs__badge num">{tab.badge}</span> : null}
              </button>
            )
          })}
          {indicator ? (
            <span
              aria-hidden="true"
              className="th-tabs__indicator"
              style={{ transform: `translateX(${indicator.x}px)`, width: indicator.w }}
            />
          ) : null}
        </div>
      </div>
      <div
        ref={panelRef}
        key={value}
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${value}`}
        className={`th-tabpanel th-tabpanel--${direction}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null
        }}
      >
        {children(value)}
      </div>
    </>
  )
}
