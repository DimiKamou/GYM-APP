import type { LocalDate, Uuid } from '@/domain/types'

/**
 * The query-key factory.
 *
 * Every key that describes gym data starts with `['gym', gymId]`. That prefix is not
 * decoration: the read cache is persisted to IndexedDB and survives a sign-out, so a coach
 * who covers at a second gym — or an owner who is removed from one — would otherwise be
 * served the previous gym's roster from disk with no request in flight to correct it.
 * The prefix also makes "throw away everything for this gym" a single
 * `removeQueries({ queryKey: keys.gym(gymId) })`.
 *
 * Keys are `as const` so `useQuery` infers literal tuples and a typo in a segment is a
 * compile error rather than a silently separate cache entry.
 */
export const keys = {
  /** Identity, not gym data: it is what tells us which gym we are allowed to ask about. */
  session: () => ['auth', 'session'] as const,
  me: (userId: Uuid) => ['auth', 'me', userId] as const,

  /** The root of one gym's cache. Never used for a query — only for invalidate/remove. */
  gym: (gymId: Uuid) => ['gym', gymId] as const,
  gymProfile: (gymId: Uuid) => ['gym', gymId, 'profile'] as const,

  team: (gymId: Uuid) => ['gym', gymId, 'team'] as const,
  invites: (gymId: Uuid) => ['gym', gymId, 'invites'] as const,

  athletes: (gymId: Uuid) => ['gym', gymId, 'athletes'] as const,
  athleteList: (gymId: Uuid, search = '') => ['gym', gymId, 'athletes', 'list', search] as const,
  athlete: (gymId: Uuid, athleteId: Uuid) => ['gym', gymId, 'athletes', athleteId] as const,
  /** The five-second read. Kept its own key so it can be prefetched on roster hover/tap. */
  briefing: (gymId: Uuid, athleteId: Uuid) =>
    ['gym', gymId, 'athletes', athleteId, 'briefing'] as const,
  athleteSessions: (gymId: Uuid, athleteId: Uuid) =>
    ['gym', gymId, 'athletes', athleteId, 'sessions'] as const,
  athleteNotes: (gymId: Uuid, athleteId: Uuid) =>
    ['gym', gymId, 'athletes', athleteId, 'notes'] as const,
  athleteProgress: (gymId: Uuid, athleteId: Uuid, exerciseId: Uuid | null = null) =>
    ['gym', gymId, 'athletes', athleteId, 'progress', exerciseId] as const,

  sessions: (gymId: Uuid) => ['gym', gymId, 'sessions'] as const,
  /** The whole tree (session + blocks + sets) — the Log screen reads exactly one of these. */
  sessionTree: (gymId: Uuid, sessionId: Uuid) =>
    ['gym', gymId, 'sessions', sessionId, 'tree'] as const,
  sessionEvents: (gymId: Uuid, sessionId: Uuid) =>
    ['gym', gymId, 'sessions', sessionId, 'events'] as const,

  exercises: (gymId: Uuid) => ['gym', gymId, 'exercises'] as const,
  /** Gym-scoped although the catalogue is shared: a gym's own additions merge into it. */
  exerciseCatalogue: (gymId: Uuid) => ['gym', gymId, 'exercises', 'catalogue'] as const,
  exercise: (gymId: Uuid, exerciseId: Uuid) => ['gym', gymId, 'exercises', exerciseId] as const,
  /** "80×8 · 12 Αυγ · Μαρία" — per athlete *and* exercise, never cached per exercise alone. */
  lastPerformance: (gymId: Uuid, athleteId: Uuid, exerciseId: Uuid) =>
    ['gym', gymId, 'athletes', athleteId, 'last-performance', exerciseId] as const,

  appointments: (gymId: Uuid) => ['gym', gymId, 'appointments'] as const,
  appointmentsWeek: (gymId: Uuid, weekStart: LocalDate) =>
    ['gym', gymId, 'appointments', 'week', weekStart] as const,
  appointmentsDay: (gymId: Uuid, date: LocalDate) =>
    ['gym', gymId, 'appointments', 'day', date] as const,
} as const

export type QueryKeys = typeof keys
