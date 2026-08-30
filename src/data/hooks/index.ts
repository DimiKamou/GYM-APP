/**
 * Every hook a screen needs, plus the one piece of shared behaviour that is not a query.
 *
 * `useUndoableDelete` is the confirm-dialog replacement. The rule from the build notes is that
 * deletion is soft everywhere and the affordance is an undo toast, not a modal: a confirm
 * dialog on a phone held at arm's length in a gym is tapped through without being read, so it
 * prevents nothing and costs a tap every single time. An undo costs nothing until it is needed
 * and is the only one of the two that helps after the mistake has already happened.
 *
 * The two exceptions the notes keep — removing an athlete and removing a trainer — still get
 * a real confirm, because neither is recoverable from a toast that has already faded.
 */

import { useCallback, useRef, useState } from 'react'

import { useDeleteSet, useRestoreSet, type SetRef } from '@/data/hooks/useSession'
import type { WriteState } from '@/data/repo/types'

export * from '@/data/hooks/useAthletes'
export * from '@/data/hooks/useSession'
export * from '@/data/hooks/useExercises'
export * from '@/data/hooks/useNotes'
export * from '@/data/hooks/useAppointments'
export * from '@/data/hooks/useTeam'
export { useRepo, useRepoKind, RepoProvider } from '@/data/repo/useRepo'

/** What a soft delete hands back: how it went, and how to take it back. */
export interface UndoHandle {
  state: WriteState
  /** Null when the caller supplied no restore — the toast then has nothing to offer. */
  undo: (() => Promise<WriteState>) | null
}

export interface UndoableDeleteOptions<A> {
  remove: (arg: A) => Promise<WriteState>
  /**
   * The inverse. Omitted only where the repository genuinely has no restore for that entity,
   * in which case `UndoHandle.undo` is null and the screen must fall back to a confirm.
   */
  restore?: (arg: A) => Promise<WriteState>
}

export interface UndoableDelete<A> {
  remove: (arg: A) => Promise<UndoHandle>
  isPending: boolean
}

/**
 * Wraps a delete/restore pair into the shape a toast wants.
 *
 * It takes the two mutation functions rather than calling the repository itself, so the cache
 * invalidation stays in the mutation that owns it — the undo path invalidates exactly what the
 * delete path did, which is what stops a restored set from reappearing only after a refresh.
 */
export function useUndoableDelete<A>(options: UndoableDeleteOptions<A>): UndoableDelete<A> {
  const [isPending, setPending] = useState(false)
  // Held in a ref so a caller passing inline arrows does not re-create `remove` every render
  // and re-arm every effect that depends on it.
  const latest = useRef(options)
  latest.current = options

  const remove = useCallback(async (arg: A): Promise<UndoHandle> => {
    setPending(true)
    try {
      const state = await latest.current.remove(arg)
      const restore = latest.current.restore
      // No undo offered for a write that never landed: the row is still there.
      if (state === 'failed' || !restore) return { state, undo: null }
      return { state, undo: () => restore(arg) }
    } finally {
      setPending(false)
    }
  }, [])

  return { remove, isPending }
}

/**
 * The one every Log screen uses: delete a set, get an undo back.
 *
 * `restoreSet` un-tombstones the row in place, so the set keeps its id, its position among its
 * siblings and the name of whoever logged it. Re-inserting a copy would put a new author on a
 * number the athlete lifted last month.
 */
export function useUndoableSetDelete(): UndoableDelete<SetRef> {
  const remove = useDeleteSet()
  const restore = useRestoreSet()
  return useUndoableDelete<SetRef>({
    remove: (ref) => remove.mutateAsync(ref),
    restore: (ref) => restore.mutateAsync(ref),
  })
}
