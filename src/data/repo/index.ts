/**
 * Which repository the app is holding.
 *
 * The decision is made once, at module load, and never re-made: a repo that could change
 * underneath a mounted screen would leave React Query holding one backend's rows under keys
 * another backend is refetching, and the two disagree about what a soft-deleted row is.
 *
 * `VITE_OFFLINE_FIXTURE=1` forces the local repo even when Supabase IS configured. That is
 * how the e2e suite and a demo on a stage run against known data without pointing a real gym's
 * project at a test — and it is deliberately an env var rather than a runtime toggle, so it
 * cannot be flipped by accident on a coach's phone.
 */

import { isSupabaseConfigured } from '@/data/supabase'
import { createLocalRepo } from '@/data/repo/local'
import { createSupabaseRepo } from '@/data/repo/supabase'
import type { Repo } from '@/data/repo/types'

function readFlag(name: 'VITE_OFFLINE_FIXTURE'): boolean {
  // `import.meta.env` is typed with an index signature returning `any`; the cast stops that
  // `any` from leaking out of this function.
  const raw = import.meta.env[name] as string | undefined
  const value = (raw ?? '').trim().toLowerCase()
  return value === '1' || value === 'true'
}

export const isOfflineFixture = readFlag('VITE_OFFLINE_FIXTURE')

/** True when there is no server: the demo gym, seeded locally, fully usable with no sign-in. */
export const isLocalRepo = isOfflineFixture || !isSupabaseConfigured

export function createRepo(): Repo {
  return isLocalRepo ? createLocalRepo() : createSupabaseRepo()
}

/** The one instance the whole app shares. */
export const repo: Repo = createRepo()

export { createLocalRepo } from '@/data/repo/local'
export { createSupabaseRepo } from '@/data/repo/supabase'
export * from '@/data/repo/types'
// `useRepo` is deliberately NOT re-exported here: it imports the singleton below, and an
// `export … from` is hoisted like an import, so re-exporting it would evaluate that module
// before `repo` is assigned and read a const in its temporal dead zone.
