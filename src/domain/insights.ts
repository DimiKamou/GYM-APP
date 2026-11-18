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
import type { LocalDate, Session, Uuid, WorkoutSet } from '@/domain/types'

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

/** What a record is measured in: kilos (estimated 1RM), reps, seconds held, or metres covered. */
export type RecordMeasure = 'kg' | 'reps' | 'seconds' | 'meters'

export interface PersonalRecord {
  exerciseId: Uuid
  measure: RecordMeasure
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

/**
 * A plank, a run, a row: no load and no reps, so the best day is the longest time — or, for
 * work logged only in metres, the longest distance. Same tie rule as the lifts.
 */
function enduranceRecord(
  data: AnalyticsData,
  athleteId: Uuid,
  exerciseId: Uuid,
): Pick<PersonalRecord, 'measure' | 'value' | 'sessionId' | 'date' | 'sessions'> | null {
  const blocksBySession = new Map<Uuid, Uuid[]>()
  for (const block of data.blocks) {
    if (block.deletedAt !== null || block.exerciseId !== exerciseId) continue
    blocksBySession.set(block.sessionId, [...(blocksBySession.get(block.sessionId) ?? []), block.id])
  }
  const setsByBlock = new Map<Uuid, WorkoutSet[]>()
  for (const set of data.sets) {
    if (set.deletedAt !== null) continue
    setsByBlock.set(set.blockId, [...(setsByBlock.get(set.blockId) ?? []), set])
  }
  let seconds: { value: number; session: Session } | null = null
  let meters: { value: number; session: Session } | null = null
  let count = 0
  for (const session of athleteSessionsAsc(data.sessions, athleteId)) {
    const sets = (blocksBySession.get(session.id) ?? []).flatMap((id) => setsByBlock.get(id) ?? [])
    if (sets.length === 0) continue
    count += 1
    for (const set of sets) {
      if ((set.seconds ?? 0) > (seconds?.value ?? 0)) seconds = { value: set.seconds ?? 0, session }
      if ((set.meters ?? 0) > (meters?.value ?? 0)) meters = { value: set.meters ?? 0, session }
    }
  }
  const best = seconds ? { ...seconds, measure: 'seconds' as const } : meters ? { ...meters, measure: 'meters' as const } : null
  return best
    ? { measure: best.measure, value: best.value, sessionId: best.session.id, date: best.session.localDate, sessions: count }
    : null
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
    if (!best) continue
    if ((trend.weighted ? best.oneRm : best.topReps) <= 0) {
      // Neither a load nor reps: ranked by time or distance instead — never "0 reps".
      const endurance = enduranceRecord(data, athleteId, usage.exerciseId)
      if (!endurance || endurance.value <= 0) continue
      const held = sessionById.get(endurance.sessionId)
      records.push({
        exerciseId: usage.exerciseId,
        weighted: false,
        topKg: 0,
        topReps: 0,
        authorId: held ? sessionAuthorId(held) : null,
        ...endurance,
      })
      continue
    }
    const session = sessionById.get(best.sessionId)
    records.push({
      exerciseId: usage.exerciseId,
      measure: trend.weighted ? 'kg' : 'reps',
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
