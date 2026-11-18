import { describe, expect, it } from 'vitest'

import type { AnalyticsData } from '@/domain/analytics'
import { mondayOf, personalRecords, weeklyFrequency, weekStreak } from '@/domain/insights'
import type { Block, Exercise, Session, WorkoutSet } from '@/domain/types'

const A = 'ath-1'
const live = { deletedAt: null }

function session(id: string, localDate: string, by = 'mem-maria', athleteId = A): Session {
  return { ...live, id, athleteId, localDate, startedAt: `${localDate}T08:00:00Z`, loggedBy: by, creditedTo: null } as unknown as Session
}
const block = (id: string, sessionId: string, exerciseId: string) =>
  ({ ...live, id, sessionId, exerciseId, position: 0 }) as unknown as Block
const set = (id: string, blockId: string, loadKg: number | null, reps: number) =>
  ({ ...live, id, blockId, position: 0, kind: 'weight_reps', loadKg, reps, doneAt: '2026-01-01T00:00:00Z' }) as unknown as WorkoutSet
const exercise = (id: string) => ({ ...live, id, category: 'upper', nameEn: id, nameEl: null }) as unknown as Exercise

describe('weeks', () => {
  it('finds the Monday, Sunday included', () => {
    expect(mondayOf('2026-11-11')).toBe('2026-11-09')
    expect(mondayOf('2026-11-15')).toBe('2026-11-09')
    expect(mondayOf('2026-11-09')).toBe('2026-11-09')
  })

  it('counts sessions per week and keeps the empty weeks', () => {
    const sessions = [session('s1', '2026-11-10'), session('s2', '2026-11-11'), session('s3', '2026-10-27'), session('x', '2026-11-10', 'm', 'other')]
    expect(weeklyFrequency(sessions, A, '2026-11-11', 3)).toEqual([
      { weekStart: '2026-10-26', sessions: 1 },
      { weekStart: '2026-11-02', sessions: 0 },
      { weekStart: '2026-11-09', sessions: 2 },
    ])
  })

  it('does not break a streak on a Monday before the first session of the week', () => {
    const sessions = [session('a', '2026-11-04'), session('b', '2026-10-28'), session('c', '2026-10-14')]
    expect(weekStreak(sessions, A, '2026-11-09')).toBe(2)
    expect(weekStreak(sessions, A, '2026-11-20')).toBe(0)
  })
})

describe('personal records', () => {
  const data: AnalyticsData = {
    sessions: [session('s1', '2026-10-01', 'mem-maria'), session('s2', '2026-10-08', 'mem-nikos'), session('s3', '2026-10-15', 'mem-maria')],
    blocks: [block('b1', 's1', 'bench'), block('b2', 's2', 'bench'), block('b3', 's3', 'bench'), block('b4', 's3', 'pullup')],
    sets: [set('x1', 'b1', 60, 10), set('x2', 'b2', 80, 5), set('x3', 'b3', 70, 8), set('x4', 'b4', null, 12)],
    exercises: [exercise('bench'), exercise('pullup')],
  }

  it('keeps the best day with its date and author, and bodyweight work by reps', () => {
    const records = personalRecords(data, A)
    const bench = records.find((r) => r.exerciseId === 'bench')
    // 80×5 → 93; 70×8 → 89; 60×10 → 80.
    expect(bench).toMatchObject({ weighted: true, value: 93, date: '2026-10-08', authorId: 'mem-nikos', sessions: 3 })
    const pullup = records.find((r) => r.exerciseId === 'pullup')
    expect(pullup).toMatchObject({ weighted: false, value: 12, date: '2026-10-15' })
    expect(records[0].exerciseId).toBe('pullup')
  })

  it('leaves out work with neither load nor reps, rather than calling 0 a record', () => {
    const plank: AnalyticsData = {
      ...data,
      blocks: [...data.blocks, block('b5', 's3', 'plank')],
      sets: [...data.sets, set('x5', 'b5', null, 0)],
      exercises: [...data.exercises, exercise('plank')],
    }
    expect(personalRecords(plank, A).some((r) => r.exerciseId === 'plank')).toBe(false)
  })
})
