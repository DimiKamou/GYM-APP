/**
 * Notes: the part of the sheet a covering coach reads first.
 *
 * There is no `useUpdateNote`, and its absence is the design. Notes are append-only — a
 * correction is a new note — because a note is the one field two coaches contend for on the
 * SAME row. Under last-write-wins, a trainer holding a three-week-old copy would republish it
 * over a colleague's warning and nobody would see an error.
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
import type { Note, Uuid } from '@/domain/types'

const NONE = 'none'

export type AuthoredNote = Note & { authorName: string | null }

function invalidateNotes(client: QueryClient, gymId: Uuid, athleteId: Uuid): void {
  void client.invalidateQueries({ queryKey: keys.athleteNotes(gymId, athleteId) })
  // The briefing renders the pinned notes and the latest one, so it moves with them.
  void client.invalidateQueries({ queryKey: keys.briefing(gymId, athleteId) })
}

export function useNotes(athleteId: Uuid | undefined): UseQueryResult<AuthoredNote[]> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    queryKey: keys.athleteNotes(gymId, athleteId ?? NONE),
    queryFn: () => repo.listNotes(gymId, athleteId as Uuid),
    enabled: athleteId !== undefined,
  })
}

export interface AddNoteVars {
  id: Uuid
  athleteId: Uuid
  body: string
  pinned?: boolean
  sessionId?: Uuid | null
}

export function useAddNote(): UseMutationResult<WriteState, Error, AddNoteVars> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: AddNoteVars) =>
      repo.addNote(gymId, vars.id, vars.athleteId, vars.body, {
        pinned: vars.pinned ?? false,
        sessionId: vars.sessionId ?? null,
      }),
    onSettled: (_state, _error, vars) => invalidateNotes(client, gymId, vars.athleteId),
  })
}

export interface NoteRef {
  noteId: Uuid
  athleteId: Uuid
}

/** `pinned` is the one mutable field on a note. `body` and `author` are not, ever. */
export function useSetNotePinned(): UseMutationResult<
  WriteState,
  Error,
  NoteRef & { pinned: boolean }
> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: NoteRef & { pinned: boolean }) =>
      repo.setNotePinned(gymId, vars.noteId, vars.pinned),
    async onMutate(vars) {
      const key = keys.athleteNotes(gymId, vars.athleteId)
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<AuthoredNote[]>(key)
      if (previous) {
        client.setQueryData<AuthoredNote[]>(
          key,
          previous.map((note) => (note.id === vars.noteId ? { ...note, pinned: vars.pinned } : note)),
        )
      }
      return { key, previous }
    },
    onError(_error, _vars, context) {
      if (context?.previous !== undefined) client.setQueryData(context.key, context.previous)
    },
    onSettled: (_state, _error, vars) => invalidateNotes(client, gymId, vars.athleteId),
  })
}

/**
 * Dismiss, not delete. The note stays on the athlete's list with the stamp of who dismissed
 * it — a warning that can be made to vanish is a warning a colleague cannot find out existed.
 */
export function useDismissNote(): UseMutationResult<WriteState, Error, NoteRef> {
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: NoteRef) => repo.dismissNote(gymId, vars.noteId),
    onSettled: (_state, _error, vars) => invalidateNotes(client, gymId, vars.athleteId),
  })
}
