/**
 * What the log screen remembers about one open workout that the database does not hold: which
 * cards the coach folded, and which old day each block was loaded from. Per tab
 * (`sessionStorage`), so a locked phone that reloads the page keeps both, and a phone handed to
 * the next coach does not.
 *
 * Guarded: in private mode the accessor itself throws, and losing this costs a fold, not a set.
 */

import { useCallback, useEffect, useState } from 'react'

import type { SetKind, Uuid } from '@/domain/types'

export interface OldSet {
  kind: SetKind
  loadKg: number | null
  reps: number | null
  seconds: number | null
  meters: number | null
}

export interface FromOld {
  /** «Πέμ 27 Αυγ · Μαρία», already rendered with its date and coach. */
  label: string
  sets: OldSet[]
}

export interface SessionMemo {
  folded: Uuid[]
  opened: Uuid[]
  fromOld: Record<Uuid, FromOld>
}

const EMPTY: SessionMemo = { folded: [], opened: [], fromOld: {} }

function key(sessionId: Uuid): string {
  return `trainhub.log.${sessionId}`
}

function read(sessionId: Uuid): SessionMemo {
  try {
    const raw = window.sessionStorage.getItem(key(sessionId))
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<SessionMemo>) } : EMPTY
  } catch {
    return EMPTY
  }
}

function write(sessionId: Uuid, memo: SessionMemo): void {
  try {
    window.sessionStorage.setItem(key(sessionId), JSON.stringify(memo))
  } catch {
    // Held in memory for this page only.
  }
}

export function useSessionMemo(sessionId: Uuid | undefined): [SessionMemo, (change: (memo: SessionMemo) => SessionMemo) => void] {
  const [memo, setMemo] = useState<SessionMemo>(() => (sessionId ? read(sessionId) : EMPTY))
  useEffect(() => {
    setMemo(sessionId ? read(sessionId) : EMPTY)
  }, [sessionId])
  const update = useCallback(
    (change: (memo: SessionMemo) => SessionMemo) => {
      setMemo((current) => {
        const next = change(current)
        if (sessionId) write(sessionId, next)
        return next
      })
    },
    [sessionId],
  )
  return [memo, update]
}
