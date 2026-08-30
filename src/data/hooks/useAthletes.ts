/**
 * The roster and one athlete's five-second read.
 *
 * Every hook here is a thin wrapper: the repository decides what the data is, the key factory
 * decides where it is cached, and this file only decides what a write invalidates. That last
 * decision is the whole reason these are not inline `useQuery` calls — an invalidation that
 * is too wide refetches the roster every time a coach types a digit, and one that is too
 * narrow leaves the briefing showing a note that has since been pinned.
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
import type { WriteState } from '@/data/repo/types'
import type { Athlete, Briefing, Uuid } from '@/domain/types'

/** A key segment no athlete id can collide with, for a query that is disabled anyway. */
const NO_ATHLETE = 'none'

/**
 * Every search box has its own cache entry, so "the roster changed" is a predicate over the
 * list entries rather than one key. Invalidating the whole `athletes` subtree instead would
 * also throw away the open athlete's briefing and session list for a rename two screens away.
 */
export function invalidateRoster(client: QueryClient, gymId: Uuid): Promise<void> {
  return client.invalidateQueries({
    queryKey: keys.athletes(gymId),
    predicate: (query) => query.queryKey[3] === 'list',
  })
}

export function useAthletes(search = ''): UseQueryResult<Athlete[]> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    queryKey: keys.athleteList(gymId, search),
    queryFn: () => repo.listAthletes(gymId, search),
  })
}

export function useAthlete(athleteId: Uuid | undefined): UseQueryResult<Athlete | null> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    queryKey: keys.athlete(gymId, athleteId ?? NO_ATHLETE),
    queryFn: () => repo.getAthlete(gymId, athleteId as Uuid),
    enabled: athleteId !== undefined,
  })
}

/** Pinned warnings, the latest note and the last session in one line. Prefetchable on tap. */
export function useBriefing(athleteId: Uuid | undefined): UseQueryResult<Briefing | null> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    queryKey: keys.briefing(gymId, athleteId ?? NO_ATHLETE),
    queryFn: () => repo.getBriefing(gymId, athleteId as Uuid),
    enabled: athleteId !== undefined,
  })
}

export interface CreateAthleteVars {
  id: Uuid
  fullName: string
}

export function useCreateAthlete(): UseMutationResult<WriteState, Error, CreateAthleteVars> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: CreateAthleteVars) => repo.createAthlete(gymId, vars.id, vars.fullName),
    onSuccess: () => invalidateRoster(client, gymId),
  })
}

export type AthletePatch = Partial<
  Pick<
    Athlete,
    'fullName' | 'coachMembershipId' | 'planPhase' | 'planFocus' | 'phone' | 'email' | 'birthDate'
  >
>

export interface UpdateAthleteVars {
  athleteId: Uuid
  patch: AthletePatch
}

export function useUpdateAthlete(): UseMutationResult<WriteState, Error, UpdateAthleteVars> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()

  return useMutation({
    mutationFn: (vars: UpdateAthleteVars) => repo.updateAthlete(gymId, vars.athleteId, vars.patch),
    async onMutate(vars) {
      const key = keys.athlete(gymId, vars.athleteId)
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<Athlete | null>(key)
      // Optimistic: renaming an athlete on a phone that is out of signal must still redraw
      // the header immediately, or the coach types it again.
      if (previous) client.setQueryData<Athlete>(key, { ...previous, ...vars.patch })
      return { previous, key }
    },
    onError(_error, _vars, context) {
      if (context?.previous !== undefined) client.setQueryData(context.key, context.previous)
    },
    onSettled(_data, _error, vars) {
      void client.invalidateQueries({ queryKey: keys.athlete(gymId, vars.athleteId) })
      void client.invalidateQueries({ queryKey: keys.briefing(gymId, vars.athleteId) })
      void invalidateRoster(client, gymId)
    },
  })
}

/** Soft delete. The only place in the app where a confirm dialog is still the right call. */
export function useArchiveAthlete(): UseMutationResult<WriteState, Error, Uuid> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (athleteId: Uuid) => repo.archiveAthlete(gymId, athleteId),
    onSuccess: () => invalidateRoster(client, gymId),
  })
}
