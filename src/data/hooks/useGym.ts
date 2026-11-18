import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query'

import { useGymId } from '@/auth/useAuth'
import { keys } from '@/data/keys'
import { useRepo } from '@/data/repo/useRepo'
import { compareSessions } from '@/domain/analytics'
import type { Athlete, LocalDate, Session, Uuid } from '@/domain/types'

/** Every session in the gym since `from`: the dashboard and the team's activity tab. */
export function useGymSessions(from: LocalDate): UseQueryResult<Session[]> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    queryKey: keys.gymSessions(gymId, from),
    queryFn: () => repo.listGymSessions(gymId, from),
    // A workout finished a minute ago belongs on the owner's screen when they look.
    staleTime: 30_000,
    refetchOnMount: 'always',
  })
}

/**
 * Each athlete's latest session date over all time, one query per athlete.
 *
 * The repository has no roster-with-last-session read. Each entry shares the key the detail
 * screen uses, so opening an athlete costs no second fetch. If a gym's roster ever outgrows one
 * screen this is the place a single server-side view pays for itself. An athlete whose query
 * has not answered yet is absent from the map; one with no sessions maps to null.
 */
export function useLastSessionDates(athletes: readonly Athlete[]): Map<Uuid, LocalDate | null> {
  const gymId = useGymId()
  const repo = useRepo()
  const results = useQueries({
    queries: athletes.map((athlete) => ({
      queryKey: keys.athleteSessions(gymId, athlete.id),
      queryFn: () => repo.listAthleteSessions(gymId, athlete.id),
      staleTime: 60_000,
    })),
  })
  const out = new Map<Uuid, LocalDate | null>()
  athletes.forEach((athlete, index) => {
    const data = results[index]?.data
    if (data !== undefined) out.set(athlete.id, latestDate(data))
  })
  return out
}

function latestDate(sessions: readonly Session[]): LocalDate | null {
  let latest: Session | null = null
  for (const session of sessions) {
    if (session.deletedAt !== null) continue
    if (!latest || compareSessions(session, latest) > 0) latest = session
  }
  return latest ? latest.localDate : null
}
