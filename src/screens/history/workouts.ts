/**
 * An athlete's past workouts, read once and drawn the same way on every screen — the log's
 * last three, the athlete sheet, the calendar and the public share page — so no two screens
 * disagree about what happened. The React twin of `streamlit/lib/history.py`.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useProgressData, useTeam } from '@/data/hooks'
import type { ProgressData } from '@/data/repo/types'
import { compareSessions } from '@/domain/analytics'
import type { RecapContext } from '@/domain/recap'
import type { Block, Exercise, Session, Uuid, WorkoutSet } from '@/domain/types'
import { currentLocale } from '@/i18n'
import { exerciseName } from '@/screens/progress/ProgressSection'

export interface Workout {
  session: Session
  blocks: Block[]
  /** Done sets only: a prescription is not a lift. */
  sets: WorkoutSet[]
}

export interface History {
  /** Newest first, only sessions that had a set done. */
  workouts: Workout[]
  ctx: RecapContext
  names: ReadonlyMap<Uuid, string>
}

type HistorySource = Pick<ProgressData, 'sessions' | 'blocks' | 'sets' | 'exercises' | 'muscleGroups' | 'exerciseMuscles'>

/** The blocks ProgressData carries are a subset; the rest of the columns get their defaults. */
function asBlock(row: ProgressData['blocks'][number], gymId: Uuid): Block {
  return {
    gymId,
    createdAt: '',
    updatedAt: '',
    createdBy: null,
    note: null,
    equipment: null,
    ...row,
  }
}

export function buildWorkouts(data: HistorySource): Workout[] {
  const blocksBySession = new Map<Uuid, Block[]>()
  for (const row of data.blocks) {
    if (row.deletedAt !== null) continue
    const block = asBlock(row, '')
    blocksBySession.set(block.sessionId, [...(blocksBySession.get(block.sessionId) ?? []), block])
  }
  const sessionOfBlock = new Map<Uuid, Uuid>()
  for (const [sessionId, blocks] of blocksBySession) for (const b of blocks) sessionOfBlock.set(b.id, sessionId)
  const setsBySession = new Map<Uuid, WorkoutSet[]>()
  for (const set of data.sets) {
    if (set.deletedAt !== null || set.doneAt === null) continue
    const sessionId = sessionOfBlock.get(set.blockId)
    if (sessionId) setsBySession.set(sessionId, [...(setsBySession.get(sessionId) ?? []), set])
  }
  return data.sessions
    .filter((s) => s.deletedAt === null && (setsBySession.get(s.id)?.length ?? 0) > 0)
    .sort((a, b) => compareSessions(b, a))
    .map((session) => ({ session, blocks: blocksBySession.get(session.id) ?? [], sets: setsBySession.get(session.id) ?? [] }))
}

export function useRecapContext(data: Pick<HistorySource, 'exercises' | 'muscleGroups' | 'exerciseMuscles'> | undefined): RecapContext {
  const { t } = useTranslation()
  const locale = currentLocale()
  return useMemo(() => {
    const exercisesById = new Map<Uuid, Exercise>((data?.exercises ?? []).map((e) => [e.id, e]))
    const groupNameOf = new Map<Uuid, string>(
      (data?.muscleGroups ?? []).map((g) => [g.id, (locale === 'en' ? g.nameEn : null) ?? g.nameEl]),
    )
    const primaryGroupOf = new Map<Uuid, string>()
    for (const link of data?.exerciseMuscles ?? []) {
      if (link.role !== 'primary' || link.deletedAt !== null) continue
      const name = groupNameOf.get(link.muscleGroupId)
      if (name && !primaryGroupOf.has(link.exerciseId)) primaryGroupOf.set(link.exerciseId, name)
    }
    return {
      exercisesById,
      primaryGroupOf,
      groupNameOf,
      exerciseName: (exercise) => (exercise ? exerciseName(exercise, locale) : '—'),
      equipmentName: (equipment) => t(`equipmentTypes.${equipment}`),
      locale,
    }
  }, [data, locale, t])
}

/** The staff's read: every workout this athlete had, with names and the coaches' names. */
export function useHistory(athleteId: Uuid | undefined): { history: History | null; pending: boolean } {
  const progress = useProgressData(athleteId)
  const team = useTeam()
  const ctx = useRecapContext(progress.data)
  const history = useMemo<History | null>(() => {
    if (!progress.data) return null
    return {
      workouts: buildWorkouts(progress.data),
      ctx,
      names: new Map((team.data ?? []).map((m) => [m.id, m.displayName])),
    }
  }, [progress.data, team.data, ctx])
  return { history, pending: progress.isPending }
}

/** The workouts strictly before `session` — so a workout reopened from last week does not
 *  summarise the ones after it. */
export function workoutsBefore(workouts: readonly Workout[], session: Session): Workout[] {
  return workouts.filter((w) => w.session.id !== session.id && compareSessions(w.session, session) < 0)
}
