/**
 * The numbers the tabs lead with: how often, how steadily, and the best day for each lift.
 *
 * Every record carries its session, its date and its author: a PR is a number a coach
 * programmes from, and the rule for those is "80×8 · 12 Αυγ · Μαρία", never "80×8".
 */

import {
  athleteExercises,
  athleteSessionsAsc,
  exerciseTrend,
  sessionAuthorId,
  type AnalyticsData,
} from '@/domain/analytics'
import { shiftLocalDate, weekdayOf } from '@/domain/calendar'
import type { LocalDate, Session, Uuid } from '@/domain/types'

export interface WeekCount {
  weekStart: LocalDate
  sessions: number
}

/** The Monday of `date`'s week. */
export function mondayOf(date: LocalDate): LocalDate {
  return shiftLocalDate(date, -weekdayOf(date))
}

/** Sessions per Monday-based week, the last `weeks` weeks up to and including `today`'s. */
export function weeklyFrequency(
  sessions: readonly Session[],
  athleteId: Uuid,
  today: LocalDate,
  weeks = 12,
): WeekCount[] {
  const counts = new Map<LocalDate, number>()
  for (const session of athleteSessionsAsc(sessions, athleteId)) {
    const week = mondayOf(session.localDate)
    counts.set(week, (counts.get(week) ?? 0) + 1)
  }
  const thisWeek = mondayOf(today)
  const out: WeekCount[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const week = shiftLocalDate(thisWeek, -7 * i)
    out.push({ weekStart: week, sessions: counts.get(week) ?? 0 })
  }
  return out
}

/**
 * Consecutive weeks with at least one session, ending this week — or last week, when this
 * week has not had its session yet. A Monday morning must not read as a broken streak.
 */
export function weekStreak(sessions: readonly Session[], athleteId: Uuid, today: LocalDate): number {
  const trained = new Set(athleteSessionsAsc(sessions, athleteId).map((s) => mondayOf(s.localDate)))
  let week = mondayOf(today)
  if (!trained.has(week)) week = shiftLocalDate(week, -7)
  let streak = 0
  while (trained.has(week)) {
    streak += 1
    week = shiftLocalDate(week, -7)
  }
  return streak
}

export interface PersonalRecord {
  exerciseId: Uuid
  /** Kilos: the estimated 1RM. Bodyweight: the most reps in one set. */
  weighted: boolean
  value: number
  topKg: number
  topReps: number
  sessionId: Uuid
  date: LocalDate
  authorId: Uuid | null
  /** How many sessions of this exercise the record was chosen from. */
  sessions: number
}

/** The best session per exercise, newest record first. Ties go to the earlier day: that is when it was set. */
export function personalRecords(data: AnalyticsData, athleteId: Uuid): PersonalRecord[] {
  const sessionById = new Map(data.sessions.map((s) => [s.id, s]))
  const records: PersonalRecord[] = []
  for (const usage of athleteExercises(data, athleteId)) {
    const trend = exerciseTrend(data, athleteId, usage.exerciseId)
    let best: (typeof trend.points)[number] | null = null
    for (const point of trend.points) {
      const value = trend.weighted ? point.oneRm : point.topReps
      const bestValue = best ? (trend.weighted ? best.oneRm : best.topReps) : -1
      if (value > bestValue) best = point
    }
    // A plank or a run has neither a load nor reps: its best is in seconds or metres, which
    // this list does not rank yet. "0 reps" would be a record nobody set.
    if (!best || (trend.weighted ? best.oneRm : best.topReps) <= 0) continue
    const session = sessionById.get(best.sessionId)
    records.push({
      exerciseId: usage.exerciseId,
      weighted: trend.weighted,
      value: trend.weighted ? best.oneRm : best.topReps,
      topKg: best.topKg,
      topReps: best.topReps,
      sessionId: best.sessionId,
      date: best.date,
      authorId: session ? sessionAuthorId(session) : null,
      sessions: trend.points.length,
    })
  }
  return records.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
