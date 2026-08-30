/**
 * The exercise catalogue and the picker's first screen.
 *
 * `useRecentExercises` is the one that matters. Personal training is repetitive: the eight
 * movements this athlete did most recently beat any search box, and for a brand-new athlete
 * the repository falls back to the gym's most-logged rather than an empty list — the first
 * session with a client is exactly when a coach has the least attention to spare.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { useGymId } from '@/auth/useAuth'
import { keys } from '@/data/keys'
import { useRepo } from '@/data/repo/useRepo'
import type { NewExerciseInput, RecentExercise, Repo, WriteState } from '@/data/repo/types'
import type { Exercise, Uuid } from '@/domain/types'

const NONE = 'none'

export function useExercises(): UseQueryResult<Exercise[]> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    queryKey: keys.exerciseCatalogue(gymId),
    queryFn: () => repo.listExercises(gymId),
    // The catalogue changes when a coach adds a movement, which is a handful of times a year.
    staleTime: 10 * 60_000,
  })
}

export function useRecentExercises(
  athleteId: Uuid | undefined,
  limit?: number,
): UseQueryResult<RecentExercise[]> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    // Per athlete: "recent" means recent for THIS athlete, and caching it under the gym's
    // catalogue key would show one client's habits while logging another's session.
    queryKey: [...keys.athlete(gymId, athleteId ?? NONE), 'recent-exercises', limit ?? null],
    queryFn: () => repo.listRecentExercises(gymId, athleteId as Uuid, limit),
    enabled: athleteId !== undefined,
  })
}

/**
 * Everything an archived — or un-archived — exercise is cached under.
 *
 * The catalogue key is the obvious half. The other half is the picker's "recently, for this
 * athlete" list, which is cached under the ATHLETE keys precisely because "recent" is per
 * athlete: invalidating the exercise subtree alone leaves the picker offering a movement that
 * has just left the library, and the coach taps it.
 */
function invalidateCatalogue(client: QueryClient, gymId: Uuid): void {
  void client.invalidateQueries({ queryKey: keys.exercises(gymId) })
  void client.invalidateQueries({
    queryKey: keys.athletes(gymId),
    predicate: (query) => query.queryKey.includes('recent-exercises'),
  })
}

export function useCreateExercise(): UseMutationResult<WriteState, Error, NewExerciseInput> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: NewExerciseInput) => repo.createExercise(gymId, input),
    onSuccess: () => invalidateCatalogue(client, gymId),
  })
}

/** Archived, never deleted: three months of blocks point at this row. */
export function useArchiveExercise(): UseMutationResult<WriteState, Error, Uuid> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (exerciseId: Uuid) => repo.archiveExercise(gymId, exerciseId),
    onSuccess: () => invalidateCatalogue(client, gymId),
  })
}

/**
 * The way back from an archive.
 *
 * A capability rather than a `Repo` method, in the same shape as `InviteRedeemer` in
 * `useTeam.ts`: `Repo` is the contract nine screens are written against and this file may not
 * widen it, but a repository that CAN clear `is_archived` says so by having the method, and
 * `exerciseUnarchiverOf` finds it structurally.
 *
 * The null case is the honest one and it is not decoration. `useUndoableDelete` documents it
 * exactly: where the repository has no restore, `UndoHandle.undo` is null and the screen falls
 * back to a confirm. An undo button that quietly does nothing is worse than the confirm it
 * replaced — the coach believes the exercise came back, and it did not.
 */
export interface ExerciseUnarchiver {
  unarchiveExercise(gymId: Uuid, exerciseId: Uuid): Promise<WriteState>
}

export function exerciseUnarchiverOf(repo: Repo): ExerciseUnarchiver | null {
  const candidate = repo as Repo & Partial<ExerciseUnarchiver>
  return typeof candidate.unarchiveExercise === 'function' ? (candidate as ExerciseUnarchiver) : null
}

/** Whether an archive on this repository has a route back — i.e. whether undo may be offered. */
export function useCanUnarchiveExercise(): boolean {
  return exerciseUnarchiverOf(useRepo()) !== null
}

export function useUnarchiveExercise(): UseMutationResult<WriteState, Error, Uuid> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (exerciseId: Uuid) => {
      const unarchiver = exerciseUnarchiverOf(repo)
      // Reported as a refused write rather than thrown: the caller renders `failed` as "it is
      // still archived", which is the truth, and a throw would surface as a crash on a screen
      // whose only sin was offering a button it should not have.
      if (!unarchiver) return Promise.resolve<WriteState>('failed')
      return unarchiver.unarchiveExercise(gymId, exerciseId)
    },
    onSuccess: () => invalidateCatalogue(client, gymId),
  })
}
