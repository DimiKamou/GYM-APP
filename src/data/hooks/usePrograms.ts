/**
 * Programmes (013) and share links (013/014). Online-only writes, like the team's: a programme
 * handed to an athlete is an owner's decision made with a signal, not an op replayed later.
 *
 * Everything here waits on `useCapabilities()`: until the owner has pasted 013 the tables do
 * not exist, and the screens offer nothing rather than an error.
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
import {
  programStoreOf,
  shareStoreOf,
  type NewProgramItemInput,
  type ProgramDayTree,
  type ProgramTree,
  type SchemaCaps,
  type SharedProgress,
  type SharePeriod,
  type WriteState,
} from '@/data/repo/types'
import { nextProgramStep } from '@/domain/recap'
import type { AthleteProgram, AthleteShare, ProgramItem, Uuid } from '@/domain/types'

const NONE: SchemaCaps = { blockGroups: false, programs: false, sharePeriods: false }

export function useCapabilities(): SchemaCaps {
  const gymId = useGymId()
  const repo = useRepo()
  const query = useQuery({
    queryKey: keys.capabilities(gymId),
    queryFn: () => repo.capabilities(gymId),
    staleTime: 60_000,
  })
  return query.data ?? NONE
}

export function usePrograms(): UseQueryResult<ProgramTree[]> {
  const gymId = useGymId()
  const repo = useRepo()
  const caps = useCapabilities()
  const store = programStoreOf(repo)
  return useQuery({
    queryKey: keys.programs(gymId),
    queryFn: () => (store ? store.list(gymId) : Promise.resolve([])),
    enabled: caps.programs && store !== null,
  })
}

export interface NextDay {
  assignment: AthleteProgram
  program: ProgramTree
  /** Index into `assignment.sequence`. */
  step: number
  day: ProgramDayTree
}

export function useAssignment(athleteId: Uuid | undefined): UseQueryResult<AthleteProgram | null> {
  const gymId = useGymId()
  const repo = useRepo()
  const caps = useCapabilities()
  const store = programStoreOf(repo)
  return useQuery({
    queryKey: keys.assignment(gymId, athleteId ?? 'none'),
    queryFn: () => (store && athleteId ? store.assignment(gymId, athleteId) : Promise.resolve(null)),
    enabled: caps.programs && store !== null && athleteId !== undefined,
  })
}

/** The day a new workout for this athlete would offer, or null when they follow nothing. */
export function useNextProgramDay(athleteId: Uuid | undefined): NextDay | null {
  const gymId = useGymId()
  const repo = useRepo()
  const store = programStoreOf(repo)
  const programs = usePrograms()
  const assignment = useAssignment(athleteId)
  const last = useQuery({
    queryKey: [...keys.assignment(gymId, athleteId ?? 'none'), 'last-step', assignment.data?.id ?? 'none'] as const,
    queryFn: () =>
      store && athleteId && assignment.data ? store.lastStep(gymId, athleteId, assignment.data.id) : Promise.resolve(null),
    enabled: Boolean(store && athleteId && assignment.data),
  })
  const row = assignment.data
  const program = row ? programs.data?.find((p) => p.id === row.programId) : undefined
  if (!row || !program || last.isPending) return null
  const step = nextProgramStep(row.sequence, last.data ?? null)
  const day = program.days.find((d) => d.position === row.sequence[step])
  return day ? { assignment: row, program, step, day } : null
}

export function useProgramItems(ids: readonly Uuid[]): UseQueryResult<ProgramItem[]> {
  const gymId = useGymId()
  const repo = useRepo()
  const store = programStoreOf(repo)
  const sorted = [...ids].sort()
  return useQuery({
    queryKey: keys.programItems(gymId, sorted.join(',')),
    queryFn: () => (store ? store.itemsByIds(gymId, sorted) : Promise.resolve([])),
    enabled: store !== null && sorted.length > 0,
    staleTime: 5 * 60_000,
  })
}

type ProgramAction =
  | { kind: 'create'; athleteId: Uuid; name: string; copyOf?: ProgramTree | null }
  | { kind: 'rename'; programId: Uuid; name: string }
  | { kind: 'addDay'; program: ProgramTree; name?: string }
  | { kind: 'addItem'; day: ProgramDayTree; input: NewProgramItemInput }
  | { kind: 'updateItem'; itemId: Uuid; patch: Partial<NewProgramItemInput> }
  | { kind: 'remove' | 'restore'; table: 'programs' | 'program_days' | 'program_items'; id: Uuid }
  | { kind: 'assign'; athleteId: Uuid; programId: Uuid; sequence: number[] }
  | { kind: 'unassign'; assignmentId: Uuid }

/** One mutation for every programme write: they all invalidate the same two trees. */
export function useProgramWrite(): UseMutationResult<WriteState, Error, ProgramAction> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (action: ProgramAction): Promise<WriteState> => {
      const store = programStoreOf(repo)
      if (!store) return 'failed'
      try {
        switch (action.kind) {
          case 'create':
            await store.createForAthlete(gymId, action.athleteId, action.name, action.copyOf)
            return 'saved'
          case 'rename':
            return store.rename(gymId, action.programId, action.name)
          case 'addDay':
            return store.addDay(gymId, action.program, action.name)
          case 'addItem':
            return store.addItem(gymId, action.day, action.input)
          case 'updateItem':
            return store.updateItem(gymId, action.itemId, action.patch)
          case 'remove':
            return store.remove(gymId, action.table, action.id)
          case 'restore':
            return store.restore(gymId, action.table, action.id)
          case 'assign':
            return store.assign(gymId, action.athleteId, action.programId, action.sequence)
          case 'unassign':
            return store.unassign(gymId, action.assignmentId)
        }
      } catch {
        return 'failed'
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.programs(gymId) })
    },
  })
}

// ---- share links ----

export function useShare(athleteId: Uuid | undefined): UseQueryResult<AthleteShare | null> {
  const gymId = useGymId()
  const repo = useRepo()
  const caps = useCapabilities()
  const store = shareStoreOf(repo)
  return useQuery({
    queryKey: keys.share(gymId, athleteId ?? 'none'),
    queryFn: () => (store && athleteId ? store.active(gymId, athleteId) : Promise.resolve(null)),
    enabled: caps.programs && store !== null && athleteId !== undefined,
    staleTime: 0,
  })
}

type ShareAction =
  | { kind: 'create'; athleteId: Uuid; period: SharePeriod | null }
  | { kind: 'period'; athleteId: Uuid; token: Uuid; period: SharePeriod }
  | { kind: 'revoke'; athleteId: Uuid; token: Uuid }

export function useShareWrite(): UseMutationResult<WriteState, Error, ShareAction> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (action: ShareAction): Promise<WriteState> => {
      const store = shareStoreOf(repo)
      if (!store) return 'failed'
      if (action.kind === 'create') return (await store.create(gymId, action.athleteId, action.period)).state
      if (action.kind === 'period') return store.setPeriod(gymId, action.token, action.period)
      return store.revoke(gymId, action.token)
    },
    onSettled: (_state, _error, action) => {
      void client.invalidateQueries({ queryKey: keys.share(gymId, action.athleteId) })
    },
  })
}

/** The public page's one read. No gym: the token is the tenant. */
export function useSharedProgress(token: Uuid | null): UseQueryResult<SharedProgress | null> {
  const repo = useRepo()
  const store = shareStoreOf(repo)
  return useQuery({
    queryKey: keys.shared(token ?? 'none'),
    queryFn: () => (store && token ? store.fetch(token) : Promise.resolve(null)),
    enabled: store !== null && token !== null,
    retry: false,
  })
}
