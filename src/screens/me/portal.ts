import type { ProgressData } from '@/data/repo/types'
import type { AthletePortal, Uuid } from '@/domain/types'

/**
 * The athlete's sheet in the shape the staff's components already take. One adapter, so the
 * history rows and the charts an athlete sees are drawn by the very code their coach reads —
 * and cannot drift into two different 1RMs for the same lift.
 */
export function portalProgress(portal: AthletePortal): ProgressData {
  return {
    sessions: portal.sessions,
    blocks: portal.blocks.map((b) => ({
      id: b.id,
      sessionId: b.sessionId,
      exerciseId: b.exerciseId,
      position: b.position,
      deletedAt: b.deletedAt,
    })),
    sets: portal.sets,
    exercises: portal.exercises,
  }
}

/** `(position, id)`, never position alone: two offline inserts can mint the same position. */
export function byPosition(a: { position: number; id: Uuid }, b: { position: number; id: Uuid }): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
