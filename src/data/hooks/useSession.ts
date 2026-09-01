/**
 * The Log screen's data, and the only mutations in the app that are typed one digit at a time.
 *
 * Two properties matter here and nowhere else:
 *
 *  - **Optimistic, always.** A coach adds a set between two working sets, standing at the
 *    rack. If the row does not appear until a round-trip finishes, they add it twice. The
 *    cached `SessionTree` is patched first and rolled back only if the write actually fails.
 *  - **Narrow invalidation.** Adding a set invalidates that session's tree and the "last time"
 *    hint for that one exercise. It does not touch the roster, the athlete's note list or the
 *    progress data — refetching those on every keypad press is how a phone on gym wifi ends
 *    up slower than the paper sheet it replaced.
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
import type { NewSessionInput, NewSetInput, ProgressData, WriteState } from '@/data/repo/types'
import type { LastPerformance, Session, SessionTree, Uuid, WorkoutSet } from '@/domain/types'

const NONE = 'none'

/** `(position, id)` — two offline inserts can mint the same position. */
function byPosition(a: { position: number; id: Uuid }, b: { position: number; id: Uuid }): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Applies an optimistic edit to the cached tree and hands back the rollback. */
async function patchTree(
  client: QueryClient,
  gymId: Uuid,
  sessionId: Uuid,
  edit: (tree: SessionTree) => SessionTree,
): Promise<{ key: readonly unknown[]; previous: SessionTree | null | undefined }> {
  const key = keys.sessionTree(gymId, sessionId)
  // Cancelled first: an in-flight refetch that resolves after our patch would overwrite it
  // with the pre-edit server state and the set would visibly vanish.
  await client.cancelQueries({ queryKey: key })
  const previous = client.getQueryData<SessionTree | null>(key)
  if (previous) client.setQueryData<SessionTree>(key, edit(previous))
  return { key, previous }
}

interface TreeContext {
  key: readonly unknown[]
  previous: SessionTree | null | undefined
}

function rollback(client: QueryClient, context: TreeContext | undefined): void {
  if (context?.previous !== undefined) client.setQueryData(context.key, context.previous)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function useSessionTree(sessionId: Uuid | undefined): UseQueryResult<SessionTree | null> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    queryKey: keys.sessionTree(gymId, sessionId ?? NONE),
    queryFn: () => repo.getSessionTree(gymId, sessionId as Uuid),
    enabled: sessionId !== undefined,
  })
}

export function useAthleteSessions(athleteId: Uuid | undefined): UseQueryResult<Session[]> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    queryKey: keys.athleteSessions(gymId, athleteId ?? NONE),
    queryFn: () => repo.listAthleteSessions(gymId, athleteId as Uuid),
    enabled: athleteId !== undefined,
  })
}

export function useProgressData(athleteId: Uuid | undefined): UseQueryResult<ProgressData> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    queryKey: keys.athleteProgress(gymId, athleteId ?? NONE),
    queryFn: () => repo.getProgressData(gymId, athleteId as Uuid),
    enabled: athleteId !== undefined,
  })
}

/**
 * "80×8 · 12 Αυγ · Μαρία" — never rendered without the date and the author it comes with.
 *
 * The key is per athlete AND exercise, as the factory defines it; `excludeSessionId` is not
 * part of it because exactly one session is open at a time, and adding it would mint a second
 * cache entry for the same question every time the coach reopened the log.
 */
export function useLastPerformance(
  athleteId: Uuid | undefined,
  exerciseId: Uuid | undefined,
  excludeSessionId?: Uuid,
): UseQueryResult<LastPerformance | null> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    queryKey: keys.lastPerformance(gymId, athleteId ?? NONE, exerciseId ?? NONE),
    queryFn: () => repo.getLastPerformance(gymId, athleteId as Uuid, exerciseId as Uuid, excludeSessionId),
    enabled: athleteId !== undefined && exerciseId !== undefined,
  })
}

// ---------------------------------------------------------------------------
// Session-level writes
// ---------------------------------------------------------------------------

export type CreateSessionVars = NewSessionInput

export function useCreateSession(): UseMutationResult<WriteState, Error, CreateSessionVars> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: CreateSessionVars) => repo.createSession(gymId, vars),
    onSuccess(_state, vars) {
      void client.invalidateQueries({ queryKey: keys.athleteSessions(gymId, vars.athleteId) })
      void client.invalidateQueries({ queryKey: keys.briefing(gymId, vars.athleteId) })
    },
  })
}

export interface UpdateSessionVars {
  sessionId: Uuid
  athleteId: Uuid
  patch: Partial<Pick<Session, 'title' | 'notes' | 'creditedTo' | 'localDate'>>
}

export function useUpdateSession(): UseMutationResult<WriteState, Error, UpdateSessionVars> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: UpdateSessionVars) => repo.updateSession(gymId, vars.sessionId, vars.patch),
    onMutate: (vars) =>
      patchTree(client, gymId, vars.sessionId, (tree) => ({ ...tree, ...vars.patch })),
    onError: (_error, _vars, context) => rollback(client, context),
    onSettled(_state, _error, vars) {
      void client.invalidateQueries({ queryKey: keys.sessionTree(gymId, vars.sessionId) })
      // Re-crediting a session changes whose name is on it, which is the briefing's whole job.
      void client.invalidateQueries({ queryKey: keys.athleteSessions(gymId, vars.athleteId) })
      void client.invalidateQueries({ queryKey: keys.briefing(gymId, vars.athleteId) })
    },
  })
}

export interface SessionRef {
  sessionId: Uuid
  athleteId: Uuid
}

export function useFinishSession(): UseMutationResult<WriteState, Error, SessionRef> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: SessionRef) => repo.finishSession(gymId, vars.sessionId),
    onSettled(_state, _error, vars) {
      void client.invalidateQueries({ queryKey: keys.sessionTree(gymId, vars.sessionId) })
      void client.invalidateQueries({ queryKey: keys.athleteSessions(gymId, vars.athleteId) })
      void client.invalidateQueries({ queryKey: keys.briefing(gymId, vars.athleteId) })
    },
  })
}

export function useDeleteSession(): UseMutationResult<WriteState, Error, SessionRef> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: SessionRef) => repo.deleteSession(gymId, vars.sessionId),
    onSettled(_state, _error, vars) {
      void client.invalidateQueries({ queryKey: keys.athleteSessions(gymId, vars.athleteId) })
      void client.invalidateQueries({ queryKey: keys.briefing(gymId, vars.athleteId) })
      void client.invalidateQueries({ queryKey: keys.athleteProgress(gymId, vars.athleteId) })
    },
  })
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export interface AddBlockVars {
  sessionId: Uuid
  blockId: Uuid
  exerciseId: Uuid
  position: number
}

export function useAddBlock(): UseMutationResult<WriteState, Error, AddBlockVars> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: AddBlockVars) =>
      repo.addBlock(gymId, vars.sessionId, vars.blockId, vars.exerciseId, vars.position),
    onSettled(_state, _error, vars) {
      void client.invalidateQueries({ queryKey: keys.sessionTree(gymId, vars.sessionId) })
    },
  })
}

export interface BlockRef {
  sessionId: Uuid
  blockId: Uuid
}

export function useSetBlockExercise(): UseMutationResult<
  WriteState,
  Error,
  BlockRef & { exerciseId: Uuid }
> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: BlockRef & { exerciseId: Uuid }) =>
      repo.setBlockExercise(gymId, vars.blockId, vars.exerciseId),
    onSettled(_state, _error, vars) {
      void client.invalidateQueries({ queryKey: keys.sessionTree(gymId, vars.sessionId) })
    },
  })
}

export function useDeleteBlock(): UseMutationResult<WriteState, Error, BlockRef> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: BlockRef) => repo.deleteBlock(gymId, vars.blockId),
    onMutate: (vars) =>
      patchTree(client, gymId, vars.sessionId, (tree) => ({
        ...tree,
        blocks: tree.blocks.filter((block) => block.id !== vars.blockId),
      })),
    onError: (_error, _vars, context) => rollback(client, context),
    onSettled(_state, _error, vars) {
      void client.invalidateQueries({ queryKey: keys.sessionTree(gymId, vars.sessionId) })
    },
  })
}

// ---------------------------------------------------------------------------
// Sets — the hot path
// ---------------------------------------------------------------------------

/**
 * A set write always names its session, athlete and exercise.
 *
 * Not because the repository needs them — it does not — but because the invalidation does:
 * without the exercise id the "last time" hint for that movement would either go stale or
 * force every hint on screen to refetch.
 */
export interface SetContext {
  sessionId: Uuid
  athleteId: Uuid
  exerciseId: Uuid
}

export type AddSetVars = NewSetInput & SetContext

function invalidateAfterSetWrite(client: QueryClient, gymId: Uuid, vars: SetContext): void {
  void client.invalidateQueries({ queryKey: keys.sessionTree(gymId, vars.sessionId) })
  void client.invalidateQueries({
    queryKey: keys.lastPerformance(gymId, vars.athleteId, vars.exerciseId),
  })
  // Deliberately NOT the roster, the note list or the progress data: those change when a
  // session is created or deleted, not when a rep count is corrected.
}

export function useAddSet(): UseMutationResult<WriteState, Error, AddSetVars> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()

  return useMutation({
    mutationFn: (vars: AddSetVars) =>
      repo.addSet(gymId, {
        id: vars.id,
        blockId: vars.blockId,
        kind: vars.kind,
        position: vars.position,
        loadKg: vars.loadKg,
        reps: vars.reps,
        seconds: vars.seconds,
        meters: vars.meters,
        rpe: vars.rpe,
      }),
    onMutate: (vars) =>
      patchTree(client, gymId, vars.sessionId, (tree) => ({
        ...tree,
        blocks: tree.blocks.map((block) =>
          block.id === vars.blockId
            ? { ...block, sets: [...block.sets, draftSet(gymId, vars)].sort(byPosition) }
            : block,
        ),
      })),
    onError: (_error, _vars, context) => rollback(client, context),
    onSettled: (_state, _error, vars) => invalidateAfterSetWrite(client, gymId, vars),
  })
}

/**
 * The row the coach sees before the write lands. Its id is the real one — minted by the
 * caller, UUIDv7 — so the refetch that replaces it does not make the row jump.
 */
function draftSet(gymId: Uuid, vars: AddSetVars): WorkoutSet {
  const at = new Date().toISOString()
  return {
    id: vars.id,
    gymId,
    blockId: vars.blockId,
    position: vars.position,
    kind: vars.kind,
    targetKg: null,
    targetReps: null,
    loadKg: vars.loadKg ?? null,
    reps: vars.reps ?? null,
    seconds: vars.seconds ?? null,
    meters: vars.meters ?? null,
    rpe: vars.rpe ?? null,
    note: null,
    doneAt: at,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    createdBy: null,
  }
}

export type SetPatch = Partial<
  Pick<WorkoutSet, 'loadKg' | 'reps' | 'seconds' | 'meters' | 'rpe' | 'note' | 'doneAt'>
>

export type UpdateSetVars = SetContext & { setId: Uuid; patch: SetPatch }

export function useUpdateSet(): UseMutationResult<WriteState, Error, UpdateSetVars> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: UpdateSetVars) => repo.updateSet(gymId, vars.setId, vars.patch),
    onMutate: (vars) =>
      patchTree(client, gymId, vars.sessionId, (tree) => ({
        ...tree,
        blocks: tree.blocks.map((block) => ({
          ...block,
          sets: block.sets.map((set) => (set.id === vars.setId ? { ...set, ...vars.patch } : set)),
        })),
      })),
    onError: (_error, _vars, context) => rollback(client, context),
    onSettled: (_state, _error, vars) => invalidateAfterSetWrite(client, gymId, vars),
  })
}

export type SetRef = SetContext & { setId: Uuid }

export function useDeleteSet(): UseMutationResult<WriteState, Error, SetRef> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: SetRef) => repo.deleteSet(gymId, vars.setId),
    onMutate: (vars) =>
      patchTree(client, gymId, vars.sessionId, (tree) => ({
        ...tree,
        blocks: tree.blocks.map((block) => ({
          ...block,
          sets: block.sets.filter((set) => set.id !== vars.setId),
        })),
      })),
    onError: (_error, _vars, context) => rollback(client, context),
    onSettled: (_state, _error, vars) => invalidateAfterSetWrite(client, gymId, vars),
  })
}

/** The other half of the undo toast. Restores the row in place, id and author intact. */
export function useRestoreSet(): UseMutationResult<WriteState, Error, SetRef> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: SetRef) => repo.restoreSet(gymId, vars.setId),
    onSettled: (_state, _error, vars) => invalidateAfterSetWrite(client, gymId, vars),
  })
}
