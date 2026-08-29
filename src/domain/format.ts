/**
 * Rendering. Greek is the primary locale, which means the decimal separator on screen
 * is a comma even though every number in storage is a JS float with a dot.
 *
 * Every function here is total: given rubbish it renders a dash, never "NaN" and never
 * an exception, because these run inside list rows where one bad row would blank the
 * whole screen.
 */

import type { LocalDate, SetKind, WorkoutSet, LastPerformance } from '@/domain/types'

export type Locale = 'el' | 'en'

/** Rendered when a value is missing — a dash reads as "not recorded", "0" does not. */
export const EMPTY = '—'

const BCP47: Record<Locale, string> = { el: 'el-GR', en: 'en-GB' }

const UNITS = {
  el: { kg: 'kg', km: 'χλμ', m: 'μ.', min: 'λεπτά', min1: 'λεπτό', sec: 'δευτ.', reps: 'επαναλήψεις' },
  en: { kg: 'kg', km: 'km', m: 'm', min: 'min', min1: 'min', sec: 's', reps: 'reps' },
} as const

function formatNumber(value: number, locale: Locale, min: number, max: number): string {
  return new Intl.NumberFormat(BCP47[locale], {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(value)
}

/**
 * Session volume with the prototype's k-suffix rule: 12345 -> "12,3k" in Greek,
 * "12.3k" in English, and the ".0" dropped so 12000 is "12k".
 *
 * Below 1000 the prototype printed the raw JS number, which leaked "587.5" with a dot
 * into a Greek UI; sub-tonne volumes are rounded to whole kilos instead.
 */
export function formatVolume(kg: number, locale: Locale = 'el'): string {
  if (!Number.isFinite(kg) || kg <= 0) return '0'
  if (kg < 1000) return formatNumber(Math.round(kg), locale, 0, 0)
  return `${formatNumber(Math.round(kg / 100) / 10, locale, 0, 1)}k`
}

/**
 * A `LocalDate` is a calendar date, not an instant. It is parsed and rendered in UTC on
 * purpose: `new Date("2026-08-12")` in a browser west of Greenwich is the 11th at 21:00,
 * and the session would be shown a day early.
 */
export function formatDate(
  localDate: LocalDate,
  locale: Locale = 'el',
  options: { withYear?: boolean } = {},
): string {
  if (!localDate) return EMPTY
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate)
  if (!match) return localDate
  const [, y, m, d] = match
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  if (Number.isNaN(date.getTime())) return localDate
  return new Intl.DateTimeFormat(BCP47[locale], {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    ...(options.withYear ? { year: 'numeric' as const } : {}),
  }).format(date)
}

/** "72,5" in Greek, "72.5" in English. Two decimals, because plates go down to 1,25 kg. */
export function formatWeight(
  kg: number | null | undefined,
  locale: Locale = 'el',
  options: { unit?: boolean } = {},
): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return EMPTY
  const n = formatNumber(kg, locale, 0, 2)
  return options.unit ? `${n} ${UNITS[locale].kg}` : n
}

function formatDuration(seconds: number, locale: Locale): string {
  const u = UNITS[locale]
  if (seconds < 60) return `${Math.round(seconds)} ${u.sec}`
  const whole = Math.round(seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  // A ragged duration renders as a clock ("1:30"): "1,5 λεπτά" is not how anyone reads
  // a stopwatch, and "1 λεπτό 30 δευτ." does not fit a set row.
  if (rest !== 0) return `${minutes}:${String(rest).padStart(2, '0')}`
  return `${minutes} ${minutes === 1 ? u.min1 : u.min}`
}

function formatDistance(meters: number, locale: Locale): string {
  const u = UNITS[locale]
  if (meters >= 1000) return `${formatNumber(meters / 1000, locale, 1, 1)} ${u.km}`
  return `${formatNumber(Math.round(meters), locale, 0, 0)} ${u.m}`
}

/** The fields of a set that formatting reads. Loose so a draft row renders too. */
export type SetLike = Pick<WorkoutSet, 'kind' | 'loadKg' | 'reps' | 'seconds' | 'meters'>

/**
 * The canonical one-line rendering of a set. Each kind gets the shape a coach reads at
 * arm's length: "80×8", "10 επαναλήψεις", "20 λεπτά", "5,0 χλμ".
 *
 * `kind` is a separate parameter so a target can be rendered with the same code as the
 * performance it is compared against.
 */
export function formatSet(set: SetLike, kind: SetKind = set.kind, locale: Locale = 'el'): string {
  const u = UNITS[locale]
  const load = set.loadKg
  const reps = set.reps

  switch (kind) {
    case 'weight_reps': {
      const hasLoad = load !== null && load !== undefined && Number.isFinite(load)
      const hasReps = reps !== null && reps !== undefined && Number.isFinite(reps)
      if (hasLoad && hasReps) return `${formatWeight(load, locale)}×${reps}`
      if (hasLoad) return formatWeight(load, locale, { unit: true })
      if (hasReps) return `${reps} ${u.reps}`
      return EMPTY
    }
    case 'bodyweight': {
      if (reps === null || reps === undefined || !Number.isFinite(reps)) return EMPTY
      // Added load on a bodyweight movement (weighted dips) is written as "+10×8".
      if (load !== null && load !== undefined && load > 0) {
        return `+${formatWeight(load, locale)}×${reps}`
      }
      return `${reps} ${u.reps}`
    }
    case 'duration': {
      const s = set.seconds
      if (s === null || s === undefined || !Number.isFinite(s) || s < 0) return EMPTY
      return formatDuration(s, locale)
    }
    case 'distance': {
      const m = set.meters
      if (m === null || m === undefined || !Number.isFinite(m) || m < 0) return EMPTY
      return formatDistance(m, locale)
    }
  }
}

/**
 * "80×8 · 12 Αυγ · Μαρία".
 *
 * The author is part of the string, not an optional suffix: this number is what the
 * coach loads the bar with, and a number without provenance is worse than no number
 * when three trainers share one athlete.
 */
export function formatLastPerformance(last: LastPerformance, locale: Locale = 'el'): string {
  const parts = [formatSet(last, last.kind, locale), formatDate(last.date, locale)]
  if (last.authorName) parts.push(last.authorName)
  return parts.join(' · ')
}
