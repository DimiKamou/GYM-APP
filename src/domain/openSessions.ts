/**
 * The workouts a coach has open at once — a personal session for two or three people is two or
 * three workouts, each the athlete's own sheet, logged in turns. These are the tabs above the log.
 *
 * Pure list arithmetic; where the list is kept is `src/data/openSessions.ts`.
 */

import type { Uuid } from '@/domain/types'

export interface OpenSession {
  sessionId: Uuid
  athleteId: Uuid
  /** When it was opened (ms). Old entries fall off by themselves: see OPEN_SESSION_TTL_MS. */
  openedAt: number
}

/**
 * A group session is over in an hour or so. After four, yesterday's tabs would sit above
 * today's workout and a coach would log a set on the wrong athlete — so they expire instead.
 */
export const OPEN_SESSION_TTL_MS = 4 * 60 * 60 * 1000

/** More than four people is a class, not a personal session, and the tabs stop fitting a phone. */
export const MAX_OPEN_SESSIONS = 4

export function pruneExpired(list: readonly OpenSession[], now: number): OpenSession[] {
  return list.filter((entry) => now - entry.openedAt < OPEN_SESSION_TTL_MS)
}

/**
 * Adds a workout as the last tab, or leaves an open one where it is (its clock restarted, so a
 * long session that is still being logged does not expire under the coach). Over the limit, the
 * oldest tab goes.
 */
export function withOpened(list: readonly OpenSession[], entry: Omit<OpenSession, 'openedAt'>, now: number): OpenSession[] {
  const live = pruneExpired(list, now)
  const existing = live.findIndex((e) => e.sessionId === entry.sessionId)
  if (existing >= 0) return live.map((e, i) => (i === existing ? { ...e, openedAt: now } : e))
  // One workout per athlete: a second "Νέα προπόνηση" for the same person replaces their tab.
  const next = [...live.filter((e) => e.athleteId !== entry.athleteId), { ...entry, openedAt: now }]
  return next.slice(-MAX_OPEN_SESSIONS)
}

export function withoutSession(list: readonly OpenSession[], sessionId: Uuid): OpenSession[] {
  return list.filter((e) => e.sessionId !== sessionId)
}

/** Where to go when the current tab closes: the next one to its right, else the one to its left. */
export function neighbourOf(list: readonly OpenSession[], sessionId: Uuid): OpenSession | null {
  const index = list.findIndex((e) => e.sessionId === sessionId)
  if (index < 0) return list[list.length - 1] ?? null
  return list[index + 1] ?? list[index - 1] ?? null
}
