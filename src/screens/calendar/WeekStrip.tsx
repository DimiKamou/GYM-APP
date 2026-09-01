import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { addDays } from '@/data/hooks'
import type { Locale } from '@/domain/format'
import type { LocalDate } from '@/domain/types'

/**
 * The seven-day strip, and the week arithmetic behind it.
 *
 * Both live here because they are the same decision: a week in this gym starts on **Monday**,
 * which is the Greek convention and is not what `Date.getUTCDay()` believes (it puts Sunday at
 * 0). Splitting the maths from the strip is how one of them ends up Sunday-first.
 *
 * A `LocalDate` is a calendar date, never an instant, so every function here parses and shifts
 * in UTC. `new Date("2026-08-30")` read in a browser west of Greenwich is the 29th at 21:00,
 * and the strip would highlight yesterday.
 *
 * The strip is rendered in the screen's FOOTER rather than under the title: it is the control a
 * coach uses most on this screen, and the top of a phone is the one place a thumb cannot reach
 * while the other hand is holding a barbell collar.
 */

/** `Locale` -> BCP-47. `@/domain/format` keeps its own copy private; this is the same table. */
const BCP47: Record<Locale, string> = { el: 'el-GR', en: 'en-GB' }

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const DAYS_IN_WEEK = 7

function parseLocalDate(date: LocalDate): Date | null {
  const match = DATE_RE.exec(date)
  if (!match) return null
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Formatting is total: a malformed date renders as itself rather than throwing. `Intl` throws a
 * RangeError on an invalid Date, and one bad row must not take the whole week down with it.
 */
function format(date: LocalDate, locale: Locale, options: Intl.DateTimeFormatOptions): string {
  const parsed = parseLocalDate(date)
  if (!parsed) return date
  return new Intl.DateTimeFormat(BCP47[locale], { timeZone: 'UTC', ...options }).format(parsed)
}

/**
 * Today, in the GYM's timezone — not the device's.
 *
 * A coach travelling, or one logging at 00:30 in Athens from a phone still set to UTC, must see
 * the day the gym is in. That is the same rule `Session.localDate` follows in the schema.
 */
export function todayIn(timeZone: string, at: Date = new Date()): LocalDate {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }
  try {
    // en-CA is ISO-ordered, so this is already `YYYY-MM-DD`.
    return new Intl.DateTimeFormat('en-CA', { timeZone, ...options }).format(at)
  } catch {
    // An IANA zone an older engine does not know must not white-screen the calendar.
    return new Intl.DateTimeFormat('en-CA', options).format(at)
  }
}

/** The Monday of the week containing `date`. */
export function mondayOf(date: LocalDate): LocalDate {
  const parsed = parseLocalDate(date)
  if (!parsed) return date
  // getUTCDay() is Sunday-first; Greek weeks are Monday-first, so Sunday is index 6, not 0.
  return addDays(date, -((parsed.getUTCDay() + 6) % 7))
}

/** Monday to Sunday, inclusive. */
export function weekDates(weekStart: LocalDate): LocalDate[] {
  return Array.from({ length: DAYS_IN_WEEK }, (_, index) => addDays(weekStart, index))
}

/** "Κυριακή, 30 Αυγούστου" — the accessible name of a day, and never abbreviated. */
export function formatFullDate(date: LocalDate, locale: Locale): string {
  return format(date, locale, { weekday: 'long', day: 'numeric', month: 'long' })
}

/** "Κυριακή, 30 Αυγ" — the heading over a day's appointments. */
export function formatDayHeading(date: LocalDate, locale: Locale): string {
  return format(date, locale, { weekday: 'long', day: 'numeric', month: 'short' })
}

/**
 * "24–30 Αυγ", or "31 Αυγ – 6 Σεπ" across a month boundary.
 *
 * The year appears only when the week is not in the current one: it is noise fifty-one weeks
 * out of fifty-two, and the one week it matters is the week someone has paged a long way back.
 */
export function formatWeekRange(weekStart: LocalDate, locale: Locale, today: LocalDate): string {
  const weekEnd = addDays(weekStart, DAYS_IN_WEEK - 1)
  const sameMonth = weekStart.slice(0, 7) === weekEnd.slice(0, 7)
  const withYear = weekStart.slice(0, 4) !== today.slice(0, 4)
  const tail: Intl.DateTimeFormatOptions = withYear ? { year: 'numeric' } : {}

  if (sameMonth) {
    const from = format(weekStart, locale, { day: 'numeric' })
    const to = format(weekEnd, locale, { day: 'numeric', month: 'short', ...tail })
    return `${from}–${to}`
  }
  const from = format(weekStart, locale, { day: 'numeric', month: 'short' })
  const to = format(weekEnd, locale, { day: 'numeric', month: 'short', ...tail })
  return `${from} – ${to}`
}

export interface WeekStripProps {
  weekStart: LocalDate
  selected: LocalDate
  today: LocalDate
  locale: Locale
  /** Appointments per day, so a day that holds work is visible without opening it. */
  counts: ReadonlyMap<LocalDate, number>
  onSelect: (date: LocalDate) => void
}

const strip: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  // 2px, not the usual gap: seven targets have to fit the narrowest phone this ships to, and
  // the whole row is one control — the space between two days is not a place to aim at.
  gap: 2,
}

const dayBase: CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  minHeight: 56,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 3,
  padding: '4px 0',
  borderRadius: 'var(--th-r-sm)',
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--th-muted)',
}

const weekdayStyle: CSSProperties = {
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
}

const dayNumberStyle: CSSProperties = { fontSize: 'var(--th-text-md)', fontWeight: 600 }

const dot: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  background: 'currentColor',
}

export function WeekStrip({
  weekStart,
  selected,
  today,
  locale,
  counts,
  onSelect,
}: WeekStripProps) {
  const { t } = useTranslation()

  return (
    <div role="group" aria-label={t('calendar.week')} style={strip}>
      {weekDates(weekStart).map((date) => {
        const isSelected = date === selected
        const isToday = date === today
        const count = counts.get(date) ?? 0

        const style: CSSProperties = { ...dayBase }
        if (isSelected) {
          style.background = 'var(--th-accent)'
          style.color = 'var(--th-accent-ink)'
        } else if (isToday) {
          style.borderColor = 'var(--th-accent)'
          style.color = 'var(--th-ink)'
        } else if (date < today) {
          // A day already worked is still reachable, just no longer the thing being decided.
          style.color = 'var(--th-faint)'
        }

        return (
          <button
            key={date}
            type="button"
            style={style}
            onClick={() => onSelect(date)}
            aria-pressed={isSelected}
            // `date` is the one aria-current value that means "the current day", and it is what
            // tells a screen-reader user which cell is today when the ring is invisible to them.
            aria-current={isToday ? 'date' : undefined}
            aria-label={`${formatFullDate(date, locale)} · ${t('counts.appointment', { count })}`}
          >
            <span style={weekdayStyle} aria-hidden="true">
              {format(date, locale, { weekday: 'short' })}
            </span>
            <span className="num" style={dayNumberStyle} aria-hidden="true">
              {format(date, locale, { day: 'numeric' })}
            </span>
            {/* Always occupies its 5px, so a day gaining an appointment does not shift the
                numbers under a thumb that is already moving toward one of them. */}
            <span style={{ ...dot, visibility: count > 0 ? 'visible' : 'hidden' }} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
