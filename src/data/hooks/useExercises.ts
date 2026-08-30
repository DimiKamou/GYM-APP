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
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { useGymId } from '@/auth/useAuth'
import { keys } from '@/data/keys'
import { useRepo } from '@/data/repo/useRepo'
import type { NewExerciseInput, RecentExercise, WriteState } from '@/data/repo/types'
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

export function useCreateExercise(): UseMutationResult<WriteState, Error, NewExerciseInput> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: NewExerciseInput) => repo.createExercise(gymId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.exercises(gymId) }),
  })
}

/** Archived, never deleted: three months of blocks point at this row. */
export function useArchiveExercise(): UseMutationResult<WriteState, Error, Uuid> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (exerciseId: Uuid) => repo.archiveExercise(gymId, exerciseId),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.exercises(gymId) }),
  })
}
