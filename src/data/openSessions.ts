import { useCallback, useSyncExternalStore } from 'react'

import { pruneExpired, withOpened, withoutSession, type OpenSession } from '@/domain/openSessions'
import type { Uuid } from '@/domain/types'

/**
 * Where a coach's open workouts are kept: this phone, per gym and per member, so a phone handed
 * to a colleague shows their tabs and not yours. localStorage rather than sessionStorage — a
 * locked phone that reloads the page mid-session must come back with all three athletes.
 *
 * Every touch is guarded: in private mode the accessor itself throws, and losing this list costs
 * a tap per athlete, never a set (the sets are in the outbox).
 */

const listeners = new Set<() => void>()
const cache = new Map<string, { raw: string | null; value: OpenSession[] }>()
const EMPTY: OpenSession[] = []

export function openSessionsKey(gymId: Uuid, membershipId: Uuid): string {
  return `trainhub.openSessions.${gymId}.${membershipId}`
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function parse(raw: string | null): OpenSession[] {
  if (!raw) return EMPTY
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return EMPTY
    return value.filter(
      (e): e is OpenSession =>
        !!e && typeof e.sessionId === 'string' && typeof e.athleteId === 'string' && typeof e.openedAt === 'number',
    )
  } catch {
    return EMPTY
  }
}

/** Stable between changes, as useSyncExternalStore requires. */
function snapshot(key: string): OpenSession[] {
  const raw = readRaw(key)
  const hit = cache.get(key)
  if (hit && hit.raw === raw) return hit.value
  const value = pruneExpired(parse(raw), Date.now())
  cache.set(key, { raw, value })
  return value
}

function write(key: string, list: OpenSession[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(list))
  } catch {
    // Nothing to do: the tabs are a convenience, and the workout itself is already saved.
  }
  cache.delete(key)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab of the app on the same phone.
  const onStorage = () => listener()
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useOpenSessions(gymId: Uuid, membershipId: Uuid | null) {
  const key = membershipId ? openSessionsKey(gymId, membershipId) : null
  const list = useSyncExternalStore(
    subscribe,
    () => (key ? snapshot(key) : EMPTY),
    () => EMPTY,
  )
  const open = useCallback(
    (sessionId: Uuid, athleteId: Uuid) => {
      if (key) write(key, withOpened(snapshot(key), { sessionId, athleteId }, Date.now()))
    },
    [key],
  )
  const close = useCallback(
    (sessionId: Uuid) => {
      if (key) write(key, withoutSession(snapshot(key), sessionId))
    },
    [key],
  )
  return { list, open, close }
}
