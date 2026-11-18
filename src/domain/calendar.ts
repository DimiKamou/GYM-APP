/**
 * Calendar arithmetic on `LocalDate`s — dates, never instants. Parsed and shifted in UTC so a
 * browser west of Greenwich cannot move a gym day across midnight.
 */

import type { LocalDate } from '@/domain/types'

export function shiftLocalDate(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d))
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

/** 0 = Monday … 6 = Sunday: the gym's week starts on Monday. */
export function weekdayOf(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

/** The month containing `date`, as `YYYY-MM`. */
export function monthOf(date: LocalDate): string {
  return date.slice(0, 7)
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1 + by, 1))
  return at.toISOString().slice(0, 7)
}

/**
 * The month as weeks of seven days, Monday first, padded with the neighbouring months' days
 * so every row is full — the grid a coach reads a training month from.
 */
export function monthWeeks(month: string): LocalDate[][] {
  const first = `${month}-01`
  let day = shiftLocalDate(first, -weekdayOf(first))
  const weeks: LocalDate[][] = []
  while (weeks.length === 0 || monthOf(day) === month) {
    const week: LocalDate[] = []
    for (let i = 0; i < 7; i++) {
      week.push(day)
      day = shiftLocalDate(day, 1)
    }
    weeks.push(week)
  }
  return weeks
}
