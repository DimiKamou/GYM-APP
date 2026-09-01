import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Icon } from '@/ui'

/**
 * The rest timer, as a bar and never as a modal.
 *
 * Two properties, both learned from watching this go wrong on paper and in the prototype:
 *
 *  - **It is timestamp-based.** The remaining time is `endsAt - Date.now()`, recomputed on
 *    every tick, not a counter decremented by an interval. An interval-based timer is wrong
 *    the moment the phone sleeps or the tab is backgrounded — which is exactly what a phone
 *    does during a 120-second rest — and it comes back claiming two minutes are left when the
 *    athlete is already under the bar.
 *  - **It never covers the log.** A rest timer that takes the screen means the coach cannot
 *    correct the set they just entered, and the set they wanted to correct is the reason they
 *    were looking at the phone at all.
 */

/** Presets are the three rests a coach actually programmes. */
const PRESETS: readonly number[] = [60, 90, 120]
const EXTEND_S = 15

export interface RestBarProps {
  /** Epoch milliseconds the current rest ends at, or null when nothing is running. */
  endsAt: number | null
  onStart: (seconds: number) => void
  onExtend: (seconds: number) => void
  onStop: () => void
}

const bar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 52,
}

const remainingStyle: CSSProperties = {
  fontSize: 'var(--th-text-xl)',
  fontWeight: 700,
  color: 'var(--th-ink)',
  minWidth: 78,
}

const idleLabel: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 'var(--th-text-xs)',
  fontWeight: 700,
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
  marginRight: 'auto',
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function RestBar({ endsAt, onStart, onExtend, onStop }: RestBarProps) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  const buzzed = useRef<number | null>(null)

  useEffect(() => {
    if (endsAt === null) return
    // Half a second, so the displayed second never lags the real one by a whole tick.
    const timer = setInterval(() => setNow(Date.now()), 500)
    // Re-read on wake: a backgrounded tab throttles this interval to once a minute or stops
    // it, and the first thing a returning coach must see is the truth, not the last frame.
    const onVisible = () => setNow(Date.now())
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [endsAt])

  const remaining = endsAt === null ? 0 : (endsAt - now) / 1000

  useEffect(() => {
    if (endsAt === null || remaining > 0 || buzzed.current === endsAt) return
    buzzed.current = endsAt
    try {
      // The phone is in a pocket or on a bench as often as in a hand. Unsupported everywhere
      // on iOS, which is why the visible bar is the real signal and this is the courtesy.
      navigator.vibrate?.([120, 60, 120])
    } catch {
      // A blocked or absent vibration API must not take the timer down with it.
    }
  }, [endsAt, remaining])

  if (endsAt === null) {
    return (
      <div style={bar}>
        <span style={idleLabel}>
          <Icon name="timer" size={16} strokeWidth={1.9} />
          {t('log.rest')}
        </span>
        {PRESETS.map((seconds) => (
          <Button
            key={seconds}
            variant="quiet"
            size="sm"
            onClick={() => onStart(seconds)}
            aria-label={t('log.restStart', { seconds })}
          >
            <span className="num">{seconds}</span>
          </Button>
        ))}
      </div>
    )
  }

  const done = remaining <= 0

  return (
    <div style={bar}>
      <span
        className="num"
        style={{ ...remainingStyle, color: done ? 'var(--th-success)' : 'var(--th-ink)' }}
        // Not a live region: a value that changes every half second would be read aloud
        // continuously and drown out everything else the screen has to say.
        aria-label={t('log.restRemaining')}
      >
        {clock(remaining)}
      </span>

      <Button variant="quiet" size="sm" onClick={() => onExtend(EXTEND_S)}>
        {t('log.restExtend')}
      </Button>
      <Button variant="quiet" size="sm" icon="x" onClick={onStop} style={{ marginLeft: 'auto' }}>
        {t('log.restStop')}
      </Button>
    </div>
  )
}
