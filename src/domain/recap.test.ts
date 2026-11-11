import { describe, expect, it } from 'vitest'

import { monthWeeks, shiftLocalDate, weekdayOf } from '@/domain/calendar'
import {
  nextProgramStep,
  parseSequence,
  setsSummary,
  singleOf,
  supersetPairs,
  targetText,
  workoutLines,
  type RecapContext,
} from '@/domain/recap'
import type { Block, Exercise, WorkoutSet } from '@/domain/types'

const AUDIT = { createdAt: '', updatedAt: '', deletedAt: null, createdBy: null }

function set(position: number, loadKg: number | null, reps: number | null, extra: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    ...AUDIT,
    id: `s${position}`,
    gymId: 'g',
    blockId: 'b1',
    position,
    kind: 'weight_reps',
    targetKg: null,
    targetReps: null,
    loadKg,
    reps,
    seconds: null,
    meters: null,
    rpe: null,
    note: null,
    doneAt: '2026-11-01T10:00:00Z',
    ...extra,
  }
}

describe('the owner’s way of writing sets', () => {
  it('folds identical sets into sets × reps, then the load', () => {
    expect(setsSummary([set(0, 60, 12), set(1, 60, 12), set(2, 60, 12)])).toBe('3×12 · 60 kg')
  })

  it('writes a pyramid set by set, kilos × reps, with the Greek decimal comma', () => {
    expect(setsSummary([set(0, 60, 12), set(1, 65, 10), set(2, 72.5, 8)])).toBe('60×12, 65×10, 72,5×8')
  })

  it('ignores a prescribed set nobody did', () => {
    expect(setsSummary([set(0, 60, 12), set(1, 60, 12, { doneAt: null })])).toBe('60×12')
  })

  it('reads a held load as the kilos, then the time', () => {
    expect(singleOf(set(0, 20, null, { kind: 'duration', seconds: 45 }))).toBe('20 kg×45 δευτ.')
  })
})

describe('a workout line', () => {
  const bench: Exercise = {
    ...AUDIT,
    id: 'e1',
    gymId: null,
    nameEl: null,
    nameEn: 'Bench Press',
    category: 'upper',
    equipment: 'barbell',
    equipmentOptions: ['barbell', 'dumbbell'],
    defaultSetKind: 'weight_reps',
    defaultRestS: 90,
    mergedIntoId: null,
    isArchived: false,
  }
  const block = (id: string, extra: Partial<Block> = {}): Block => ({
    ...AUDIT,
    id,
    gymId: 'g',
    sessionId: 's',
    exerciseId: 'e1',
    position: Number(id.slice(1)),
    note: null,
    equipment: null,
    ...extra,
  })
  const ctx: RecapContext = {
    exercisesById: new Map([['e1', bench]]),
    primaryGroupOf: new Map([['e1', 'Στήθος']]),
    groupNameOf: new Map([['mg2', 'Τρικέφαλοι']]),
    exerciseName: (e) => e?.nameEn ?? '',
    equipmentName: (e) => (e === 'dumbbell' ? 'Αλτήρες' : 'Μπάρα'),
    locale: 'el',
  }

  it('never guesses the tool of an exercise that offers a choice', () => {
    expect(workoutLines([block('b1')], [set(0, 60, 12)], ctx)).toEqual(['Στήθος · Bench Press · 60×12'])
    expect(workoutLines([block('b1', { equipment: 'dumbbell' })], [set(0, 30, 10)], ctx)).toEqual([
      'Στήθος · Bench Press · Αλτήρες · 30×10',
    ])
  })

  it('counts a block toward the group it was logged for, and marks a superset', () => {
    const blocks = [block('b1', { supersetId: 'p', muscleGroupId: 'mg2' }), block('b2', { supersetId: 'p' })]
    const sets = [set(0, 60, 12), { ...set(0, 20, 15), id: 'x', blockId: 'b2' }]
    expect(workoutLines(blocks, sets, ctx)).toEqual([
      'Super set · Τρικέφαλοι · Bench Press · 60×12',
      'Super set · Στήθος · Bench Press · 20×15',
    ])
    expect(supersetPairs(blocks).get('p')).toHaveLength(2)
    expect(supersetPairs([blocks[0]]).size).toBe(0)
  })
})

describe('programmes', () => {
  it('writes a target the way the owner does', () => {
    expect(targetText({ sets: 3, reps: 12, seconds: null, loadKg: 60, note: null })).toBe('3×12 · 60 kg')
    expect(targetText({ sets: 3, reps: null, seconds: 45, loadKg: null, note: 'αργά' })).toBe('3×45 δευτ. — αργά')
  })

  it('offers the step after the last one, wrapping round', () => {
    expect(nextProgramStep([1, 2, 1, 3], null)).toBe(0)
    expect(nextProgramStep([1, 2, 1, 3], 1)).toBe(2)
    expect(nextProgramStep([1, 2, 1, 3], 3)).toBe(0)
  })

  it('reads an order typed any of the ways a coach types it, and names what is wrong', () => {
    expect(parseSequence('1-2-1-3', [1, 2, 3])).toEqual([1, 2, 1, 3])
    expect(parseSequence('1 2, 3', [1, 2, 3])).toEqual([1, 2, 3])
    expect(() => parseSequence('1-4', [1, 2, 3])).toThrow('no-day:4')
  })
})

describe('the calendar', () => {
  it('shifts dates as dates and weeks start on Monday', () => {
    expect(shiftLocalDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(weekdayOf('2026-11-09')).toBe(0)
    const weeks = monthWeeks('2026-11')
    expect(weeks[0][0]).toBe('2026-10-26')
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks.flat()).toContain('2026-11-30')
  })
})
