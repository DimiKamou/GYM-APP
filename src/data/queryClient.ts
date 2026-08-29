import { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client'
import { del, get, set } from 'idb-keyval'

/**
 * The read cache.
 *
 * What has to survive a dead spot in the free-weights corner is not logging — a coach can
 * retype four sets, and the outbox holds them anyway — it is **reading the briefing**. So
 * this is a persisted read cache, not a replication engine: whatever was on screen last time
 * is still on screen, stamped with its age, while the network is gone.
 *
 * The numbers below are set for a gym floor, where the same athlete's page is opened by two
 * coaches an hour apart:
 *   - `staleTime` 60s — a session logged by a colleague is minutes old, never seconds. Below
 *     a minute we would refetch on every screen return for data that cannot have changed.
 *   - `gcTime` and `maxAge` both 7 days — long enough that a coach who has not opened the app
 *     since last week still gets a readable briefing before the first byte arrives. `gcTime`
 *     must not be shorter than `maxAge` or React Query garbage-collects the entries it just
 *     restored from disk.
 */

const CACHE_KEY = 'trainhub:query-cache'

/**
 * Bump this in the same commit as any change to a cached shape. It is the buster, so a stale
 * entry from before a schema change is discarded rather than hydrated into code that no
 * longer understands it — the failure mode of which is a white screen with no network error
 * to explain it.
 */
export const CACHE_SCHEMA_VERSION = 1

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '0.1.0'

export const CACHE_BUSTER = `trainhub-${APP_VERSION}-s${CACHE_SCHEMA_VERSION}`

export const STALE_TIME_MS = 60_000
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * idb-keyval, but every call is wrapped: in private mode and locked-down browsers the
 * accessor itself throws. A cache that cannot be written is a performance regression; a cache
 * whose write throws is a broken app.
 */
const idbStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return (await get<string>(key)) ?? null
    } catch {
      return null
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      await set(key, value)
    } catch {
      // Nothing to do and nothing to tell the coach: the app works, it just starts cold.
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      await del(key)
    } catch {
      // As above.
    }
  },
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME_MS,
      gcTime: CACHE_MAX_AGE_MS,
      // Offline, `networkMode: 'online'` leaves the query paused on its cached data instead
      // of resolving to an error state — the briefing stays readable, with no error card
      // over it.
      networkMode: 'online',
      retry: 2,
      refetchOnWindowFocus: true,
      // The phone came out of a pocket; the data on screen is from before that.
      refetchOnReconnect: true,
    },
    mutations: {
      // Writes do not go through here. They go through the outbox, which is the only thing
      // that can make a retry idempotent.
      retry: 0,
    },
  },
})

export const queryPersister = createAsyncStoragePersister({
  storage: idbStorage,
  key: CACHE_KEY,
  // A coach edits one set a second on the keypad; every edit invalidates and re-persists.
  // Two seconds of throttle turns a burst of thirty writes into one.
  throttleTime: 2_000,
})

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: queryPersister,
  maxAge: CACHE_MAX_AGE_MS,
  buster: CACHE_BUSTER,
  dehydrateOptions: {
    // Only settled, successful reads are worth restoring. A persisted `error` state would
    // render an error card offline for data we have a perfectly good older copy of.
    shouldDehydrateQuery: (query) => query.state.status === 'success',
    shouldDehydrateMutation: () => false,
  },
}

/**
 * Called when the signed-in identity changes or a membership turns out to be removed. Both
 * halves matter: `queryClient.clear()` alone leaves the IndexedDB copy on the device, and the
 * next boot hydrates the departed trainer's roster straight back onto the screen.
 */
export async function clearPersistedCache(): Promise<void> {
  queryClient.clear()
  try {
    await queryPersister.removeClient()
  } catch {
    // removeClient() is already guarded above; this catch is for a persister that is mid-
    // throttle when the user signs out.
  }
}
