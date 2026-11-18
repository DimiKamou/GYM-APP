/**
 * The owner's view of the whole gym: how busy it was, who is drifting away, and who did the
 * work. Pure — the dashboard and the team's Δραστηριότητα tab both read from here.
 *
 * "Who did the work" is the session's author (`creditedTo`, else `loggedBy`), the same name
 * every sheet prints, so the numbers here agree with what each athlete's history says.
 */

import { sessionAuthorId } from '@/domain/analytics'
import { shiftLocalDate } from '@/domain/calendar'
import { mondayOf, type WeekCount } from '@/domain/insights'
import type { Athlete, LocalDate, Membership, Session, Uuid } from '@/domain/types'

/** How long without a session before an athlete is listed as needing a call. */
export const DRIFT_DAYS = 14

export interface DriftingAthlete {
  athlete: Athlete
  /** Null: never trained. */
  lastDate: LocalDate | null
  /** Whole days since `lastDate`; null when never trained. */
  daysSince: number | null
}

export interface CoachActivity {
  member: Pick<Membership, 'id' | 'displayName' | 'role'>
  sessions: number
  athletes: number
  lastDate: LocalDate | null
}

export interface GymDashboard {
  thisWeek: number
  lastWeek: number
  /** Athletes with a session in the last 30 days, out of all live athletes. */
  activeAthletes: number
  totalAthletes: number
  weeks: WeekCount[]
  drifting: DriftingAthlete[]
  coaches: CoachActivity[]
}

function daysBetween(from: LocalDate, to: LocalDate): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

const live = <T extends { deletedAt: string | null }>(rows: readonly T[]) => rows.filter((r) => r.deletedAt === null)

/** Per member, over the sessions given (the caller picks the window). Busiest first. */
export function coachActivity(
  sessions: readonly Session[],
  members: readonly Pick<Membership, 'id' | 'displayName' | 'role' | 'status'>[],
): CoachActivity[] {
  const byAuthor = new Map<Uuid, { sessions: number; athletes: Set<Uuid>; last: LocalDate | null }>()
  for (const session of live(sessions)) {
    const author = sessionAuthorId(session)
    const entry = byAuthor.get(author) ?? { sessions: 0, athletes: new Set<Uuid>(), last: null }
    entry.sessions += 1
    entry.athletes.add(session.athleteId)
    if (!entry.last || session.localDate > entry.last) entry.last = session.localDate
    byAuthor.set(author, entry)
  }
  return members
    .filter((m) => m.status === 'active' || byAuthor.has(m.id))
    .map((m) => {
      const entry = byAuthor.get(m.id)
      return {
        member: { id: m.id, displayName: m.displayName, role: m.role },
        sessions: entry?.sessions ?? 0,
        athletes: entry?.athletes.size ?? 0,
        lastDate: entry?.last ?? null,
      }
    })
    .sort((a, b) => b.sessions - a.sessions || a.member.displayName.localeCompare(b.member.displayName, 'el'))
}

/**
 * `sessions` should reach back at least 12 weeks, the chart's span. `lastByAthlete` is each
 * athlete's latest session date over all time, so that an athlete last seen five months ago
 * reads "5 months", not "never", even though the window is shorter.
 */
export function gymDashboard(input: {
  sessions: readonly Session[]
  athletes: readonly Athlete[]
  members: readonly Pick<Membership, 'id' | 'displayName' | 'role' | 'status'>[]
  lastByAthlete: ReadonlyMap<Uuid, LocalDate | null>
  today: LocalDate
  weeks?: number
}): GymDashboard {
  const { athletes, members, lastByAthlete, today } = input
  const sessions = live(input.sessions)
  const span = input.weeks ?? 12
  const thisMonday = mondayOf(today)
  const lastMonday = shiftLocalDate(thisMonday, -7)

  const counts = new Map<LocalDate, number>()
  for (const s of sessions) counts.set(mondayOf(s.localDate), (counts.get(mondayOf(s.localDate)) ?? 0) + 1)
  const weeks: WeekCount[] = []
  for (let i = span - 1; i >= 0; i--) {
    const week = shiftLocalDate(thisMonday, -7 * i)
    weeks.push({ weekStart: week, sessions: counts.get(week) ?? 0 })
  }

  const monthAgo = shiftLocalDate(today, -30)
  const liveAthletes = live(athletes)
  const active = new Set(sessions.filter((s) => s.localDate >= monthAgo).map((s) => s.athleteId))

  const drifting = liveAthletes
    .map((athlete): DriftingAthlete => {
      const lastDate = lastByAthlete.get(athlete.id) ?? null
      return { athlete, lastDate, daysSince: lastDate ? daysBetween(lastDate, today) : null }
    })
    .filter((d) => d.daysSince === null || d.daysSince >= DRIFT_DAYS)
    // The longest gap first; never-trained last — they are new, not lost.
    .sort((a, b) => (b.daysSince ?? -1) - (a.daysSince ?? -1))

  return {
    thisWeek: counts.get(thisMonday) ?? 0,
    lastWeek: counts.get(lastMonday) ?? 0,
    activeAthletes: liveAthletes.filter((a) => active.has(a.id)).length,
    totalAthletes: liveAthletes.length,
    weeks,
    drifting,
    coaches: coachActivity(sessions.filter((s) => s.localDate >= monthAgo), members),
  }
}
