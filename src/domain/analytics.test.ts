import { describe, expect, it } from 'vitest'
import {
  athleteExercises,
  athleteSessionsAsc,
  bodyPartShare,
  bodyPartTrend,
  epley,
  exerciseTrend,
  lastPerformance,
  sessionAuthorId,
  sessionSets,
  sessionVolume,
  setVolume,
  type AnalyticsData,
} from '@/domain/analytics'
import type {
  Block,
  Exercise,
  ExerciseCategory,
  Membership,
  Session,
  SetKind,
  Uuid,
  WorkoutSet,
} from '@/domain/types'

// --- fixtures ---------------------------------------------------------------

const GYM = 'gym-1'
const ATHLETE = 'ath-1'
const OTHER_ATHLETE = 'ath-2'
const MARIA = 'mem-maria'
const NIKOS = 'mem-nikos'

const audit = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null, createdBy: null }

function member(id: Uuid, displayName: string): Membership {
  return {
    ...audit,
    id,
    gymId: GYM,
    userId: id,
    displayName,
    email: `${id}@ironlab.gr`,
    role: 'trainer',
    status: 'active',
  }
}

function exercise(id: Uuid, category: ExerciseCategory, defaultSetKind: SetKind = 'weight_reps'): Exercise {
  return {
    ...audit,
    id,
    gymId: GYM,
    nameEl: id,
    nameEn: id,
    category,
    equipment: 'barbell',
    defaultSetKind,
    defaultRestS: 90,
    mergedIntoId: null,
    isArchived: false,
  }
}

function session(id: Uuid, localDate: string, startedAt: string, overrides: Partial<Session> = {}): Session {
  return {
    ...audit,
    id,
    gymId: GYM,
    athleteId: ATHLETE,
    loggedBy: MARIA,
    creditedTo: null,
    appointmentId: null,
    title: null,
    notes: null,
    status: 'finished',
    startedAt,
    finishedAt: null,
    localDate,
    ...overrides,
  }
}

function block(id: Uuid, sessionId: Uuid, exerciseId: Uuid, position = 0): Block {
  return { ...audit, id, gymId: GYM, sessionId, exerciseId, position }
}

function wset(id: Uuid, blockId: Uuid, kind: SetKind, fields: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    ...audit,
    id,
    gymId: GYM,
    blockId,
    position: 0,
    kind,
    targetKg: null,
    targetReps: null,
    loadKg: null,
    reps: null,
    seconds: null,
    meters: null,
    rpe: null,
    note: null,
    doneAt: '2026-01-01T00:00:00Z',
    ...fields,
  }
}

function data(partial: Partial<AnalyticsData>): AnalyticsData {
  return {
    sessions: [],
    blocks: [],
    sets: [],
    exercises: [],
    memberships: [member(MARIA, 'Μαρία'), member(NIKOS, 'Νίκος')],
    ...partial,
  }
}

// --- volume -----------------------------------------------------------------

describe('setVolume / sessionVolume', () => {
  it('counts load only for weight_reps sets', () => {
    expect(setVolume(wset('s1', 'b1', 'weight_reps', { loadKg: 80, reps: 8 }))).toBe(640)
    expect(setVolume(wset('s2', 'b1', 'bodyweight', { reps: 10 }))).toBe(0)
    expect(setVolume(wset('s3', 'b1', 'duration', { seconds: 1200 }))).toBe(0)
    expect(setVolume(wset('s4', 'b1', 'distance', { meters: 5000 }))).toBe(0)
  })

  it('treats added load on a bodyweight set as zero, not as barbell volume', () => {
    expect(setVolume(wset('s5', 'b1', 'bodyweight', { loadKg: 20, reps: 8 }))).toBe(0)
  })

  it('sums a mixed session without letting cardio leak into the total', () => {
    const sets = [
      wset('s1', 'b1', 'weight_reps', { loadKg: 80, reps: 8 }),
      wset('s2', 'b1', 'weight_reps', { loadKg: 72.5, reps: 8 }),
      wset('s3', 'b2', 'duration', { seconds: 1200 }),
      wset('s4', 'b3', 'bodyweight', { reps: 10 }),
    ]
    expect(sessionVolume(sets)).toBe(640 + 580)
    // Same numbers the prototype produced for the barbell work; the difference is that
    // the treadmill and the pull-ups are now distinguishable rows rather than two zeros.
    expect(sessionSets(sets)).toBe(4)
  })

  it('ignores tombstoned and unperformed rows', () => {
    const sets = [
      wset('s1', 'b1', 'weight_reps', { loadKg: 80, reps: 8 }),
      wset('s2', 'b1', 'weight_reps', { loadKg: 100, reps: 5, deletedAt: '2026-02-01T00:00:00Z' }),
      wset('s3', 'b1', 'weight_reps', { doneAt: null }),
    ]
    expect(sessionVolume(sets.filter((s) => s.deletedAt === null))).toBe(640)
    expect(sessionSets(sets.filter((s) => s.deletedAt === null))).toBe(1)
  })

  it('counts a set with numbers but no doneAt, because after-the-fact logging may skip it', () => {
    const sets = [wset('s1', 'b1', 'weight_reps', { loadKg: 60, reps: 10, doneAt: null })]
    expect(sessionVolume(sets)).toBe(600)
    expect(sessionSets(sets)).toBe(1)
  })

  it('accepts a rehydrated session tree as well as a flat list', () => {
    const tree = {
      ...session('sess-1', '2026-08-12', '2026-08-12T09:00:00Z'),
      blocks: [
        {
          ...block('b1', 'sess-1', 'ex-bench'),
          sets: [wset('s1', 'b1', 'weight_reps', { loadKg: 80, reps: 8 })],
        },
      ],
    }
    expect(sessionVolume(tree)).toBe(640)
    expect(sessionSets(tree)).toBe(1)
  })
})

describe('epley', () => {
  it('is kg × (1 + reps/30)', () => {
    expect(epley(100, 0)).toBe(100)
    expect(epley(100, 30)).toBe(200)
    expect(epley(80, 8)).toBeCloseTo(101.333, 3)
  })

  it('is zero for anything unloaded', () => {
    expect(epley(0, 10)).toBe(0)
    expect(epley(-5, 10)).toBe(0)
    expect(epley(null, 10)).toBe(0)
    expect(epley(Number.NaN, 10)).toBe(0)
  })
})

// --- ordering ---------------------------------------------------------------

describe('athleteSessionsAsc', () => {
  it('orders by local date', () => {
    const sessions = [
      session('c', '2026-08-14', '2026-08-14T09:00:00Z'),
      session('a', '2026-08-12', '2026-08-12T09:00:00Z'),
      session('b', '2026-08-13', '2026-08-13T09:00:00Z'),
    ]
    expect(athleteSessionsAsc(sessions, ATHLETE).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('breaks a same-day tie on startedAt, not on array order', () => {
    // The prototype compared the date string alone, so a morning and an evening slot on
    // one day came out in whatever order the array happened to hold.
    const evening = session('evening', '2026-08-12', '2026-08-12T18:00:00Z')
    const morning = session('morning', '2026-08-12', '2026-08-12T08:00:00Z')
    expect(athleteSessionsAsc([evening, morning], ATHLETE).map((s) => s.id)).toEqual([
      'morning',
      'evening',
    ])
    expect(athleteSessionsAsc([morning, evening], ATHLETE).map((s) => s.id)).toEqual([
      'morning',
      'evening',
    ])
  })

  it('falls back to id so two devices sort an exact tie identically', () => {
    const a = session('aaa', '2026-08-12', '2026-08-12T08:00:00Z')
    const b = session('bbb', '2026-08-12', '2026-08-12T08:00:00Z')
    expect(athleteSessionsAsc([b, a], ATHLETE).map((s) => s.id)).toEqual(['aaa', 'bbb'])
    expect(athleteSessionsAsc([a, b], ATHLETE).map((s) => s.id)).toEqual(['aaa', 'bbb'])
  })

  it('filters by athlete and drops tombstones', () => {
    const sessions = [
      session('mine', '2026-08-12', '2026-08-12T08:00:00Z'),
      session('theirs', '2026-08-12', '2026-08-12T09:00:00Z', { athleteId: OTHER_ATHLETE }),
      session('deleted', '2026-08-13', '2026-08-13T08:00:00Z', { deletedAt: '2026-08-14T00:00:00Z' }),
    ]
    expect(athleteSessionsAsc(sessions, ATHLETE).map((s) => s.id)).toEqual(['mine'])
  })
})

describe('sessionAuthorId', () => {
  it('prefers the editable credit over who typed it', () => {
    expect(sessionAuthorId(session('a', '2026-08-12', '2026-08-12T08:00:00Z'))).toBe(MARIA)
    expect(
      sessionAuthorId(session('a', '2026-08-12', '2026-08-12T08:00:00Z', { creditedTo: NIKOS })),
    ).toBe(NIKOS)
  })
})

// --- aggregates -------------------------------------------------------------

const bench = exercise('ex-bench', 'upper')
const squat = exercise('ex-squat', 'lower')
const run = exercise('ex-run', 'cardio', 'distance')

describe('athleteExercises', () => {
  it('counts distinct sessions, not blocks', () => {
    // Bench appears twice in one session (a superset); the prototype scored that as two.
    const d = data({
      exercises: [bench, squat],
      sessions: [
        session('s1', '2026-08-12', '2026-08-12T08:00:00Z'),
        session('s2', '2026-08-14', '2026-08-14T08:00:00Z'),
      ],
      blocks: [
        block('b1', 's1', 'ex-bench', 0),
        block('b2', 's1', 'ex-bench', 1),
        block('b3', 's1', 'ex-squat', 2),
        block('b4', 's2', 'ex-squat', 0),
      ],
      sets: [
        wset('t1', 'b1', 'weight_reps', { loadKg: 80, reps: 8 }),
        wset('t2', 'b2', 'weight_reps', { loadKg: 70, reps: 8 }),
        wset('t3', 'b3', 'weight_reps', { loadKg: 100, reps: 5 }),
        wset('t4', 'b4', 'weight_reps', { loadKg: 105, reps: 5 }),
      ],
    })
    expect(athleteExercises(d, ATHLETE)).toEqual([
      { exerciseId: 'ex-squat', sessions: 2, sets: 2 },
      { exerciseId: 'ex-bench', sessions: 1, sets: 2 },
    ])
  })

  it('ignores an exercise that was added but never performed', () => {
    const d = data({
      exercises: [bench],
      sessions: [session('s1', '2026-08-12', '2026-08-12T08:00:00Z')],
      blocks: [block('b1', 's1', 'ex-bench')],
      sets: [wset('t1', 'b1', 'weight_reps', { doneAt: null })],
    })
    expect(athleteExercises(d, ATHLETE)).toEqual([])
  })
})

describe('exerciseTrend', () => {
  const d = data({
    exercises: [bench],
    sessions: [
      session('s2', '2026-08-14', '2026-08-14T08:00:00Z'),
      session('s1', '2026-08-12', '2026-08-12T08:00:00Z'),
    ],
    blocks: [block('b1', 's1', 'ex-bench'), block('b2', 's2', 'ex-bench')],
    sets: [
      wset('t1', 'b1', 'weight_reps', { loadKg: 80, reps: 8 }),
      wset('t2', 'b1', 'weight_reps', { loadKg: 85, reps: 5 }),
      wset('t3', 'b2', 'weight_reps', { loadKg: 90, reps: 5 }),
    ],
  })

  it('emits one point per session, oldest first, with the session top set', () => {
    const trend = exerciseTrend(d, ATHLETE, 'ex-bench')
    expect(trend.weighted).toBe(true)
    // 80×8 estimates 101 and 85×5 estimates 99: the best estimate is not the heaviest
    // set, which is exactly why the max is taken over sets rather than over load.
    expect(trend.points).toEqual([
      { sessionId: 's1', date: '2026-08-12', oneRm: 101, topKg: 85, topReps: 8, volume: 640 + 425 },
      { sessionId: 's2', date: '2026-08-14', oneRm: 105, topKg: 90, topReps: 5, volume: 450 },
    ])
  })

  it('reports weighted:false for a movement that was never loaded', () => {
    const pullups = exercise('ex-pullup', 'upper', 'bodyweight')
    const bw = data({
      exercises: [pullups],
      sessions: [session('s1', '2026-08-12', '2026-08-12T08:00:00Z')],
      blocks: [block('b1', 's1', 'ex-pullup')],
      sets: [wset('t1', 'b1', 'bodyweight', { reps: 10 })],
    })
    const trend = exerciseTrend(bw, ATHLETE, 'ex-pullup')
    expect(trend.weighted).toBe(false)
    expect(trend.points).toEqual([
      { sessionId: 's1', date: '2026-08-12', oneRm: 0, topKg: 0, topReps: 10, volume: 0 },
    ])
  })

  it('is empty for an exercise this athlete has never done', () => {
    expect(exerciseTrend(d, ATHLETE, 'ex-squat')).toEqual({ weighted: false, points: [] })
  })
})

describe('bodyPartShare / bodyPartTrend', () => {
  const base = {
    sessions: [
      session('s1', '2026-08-12', '2026-08-12T08:00:00Z'),
      session('s2', '2026-08-14', '2026-08-14T08:00:00Z'),
    ],
    blocks: [
      block('b1', 's1', 'ex-bench'),
      block('b2', 's1', 'ex-run', 1),
      block('b3', 's2', 'ex-bench'),
    ],
    sets: [
      wset('t1', 'b1', 'weight_reps', { loadKg: 80, reps: 8 }),
      wset('t2', 'b1', 'weight_reps', { loadKg: 80, reps: 8 }),
      wset('t3', 'b2', 'distance', { meters: 5000 }),
      wset('t4', 'b3', 'weight_reps', { loadKg: 85, reps: 8 }),
    ],
  }

  it('groups by the exercise category', () => {
    const d = data({ ...base, exercises: [bench, run] })
    expect(bodyPartShare(d, ATHLETE)).toEqual([
      { category: 'upper', sets: 3, volume: 640 + 640 + 680 },
      { category: 'cardio', sets: 1, volume: 0 },
    ])
  })

  it('follows a recategorised exercise instead of a stale copy on the block', () => {
    // The prototype denormalised the category onto the block at logging time, so
    // recategorising the exercise left every historical block claiming the old one.
    const d = data({ ...base, exercises: [{ ...bench, category: 'core' }, run] })
    expect(bodyPartShare(d, ATHLETE).map((s) => s.category)).toEqual(['core', 'cardio'])
  })

  it('trends one category over time and flags a loadless one', () => {
    const d = data({ ...base, exercises: [bench, run] })
    expect(bodyPartTrend(d, ATHLETE, 'upper')).toEqual({
      hasLoad: true,
      points: [
        { sessionId: 's1', date: '2026-08-12', volume: 1280, sets: 2 },
        { sessionId: 's2', date: '2026-08-14', volume: 680, sets: 1 },
      ],
    })
    expect(bodyPartTrend(d, ATHLETE, 'cardio')).toEqual({
      hasLoad: false,
      points: [{ sessionId: 's1', date: '2026-08-12', volume: 0, sets: 1 }],
    })
    expect(bodyPartTrend(d, ATHLETE, 'mobility')).toEqual({ hasLoad: false, points: [] })
  })
})

// --- last performance -------------------------------------------------------

describe('lastPerformance', () => {
  function build(sessions: Session[], blocks: Block[], sets: WorkoutSet[]): AnalyticsData {
    return data({ exercises: [bench, run], sessions, blocks, sets })
  }

  it('returns the top set with its date and author', () => {
    const d = build(
      [
        session('prev', '2026-08-12', '2026-08-12T08:00:00Z'),
        session('cur', '2026-08-19', '2026-08-19T08:00:00Z', { loggedBy: NIKOS }),
      ],
      [block('b1', 'prev', 'ex-bench'), block('b2', 'cur', 'ex-bench')],
      [
        wset('t1', 'b1', 'weight_reps', { loadKg: 75, reps: 10 }),
        wset('t2', 'b1', 'weight_reps', { loadKg: 80, reps: 8 }),
        wset('t3', 'b2', 'weight_reps', { loadKg: 85, reps: 5 }),
      ],
    )
    expect(lastPerformance(d, ATHLETE, 'ex-bench', 'cur')).toEqual({
      kind: 'weight_reps',
      loadKg: 80,
      reps: 8,
      seconds: null,
      meters: null,
      date: '2026-08-12',
      authorName: 'Μαρία',
    })
  })

  it('credits the session to creditedTo when it was reassigned', () => {
    const d = build(
      [
        session('prev', '2026-08-12', '2026-08-12T08:00:00Z', { creditedTo: NIKOS }),
        session('cur', '2026-08-19', '2026-08-19T08:00:00Z'),
      ],
      [block('b1', 'prev', 'ex-bench')],
      [wset('t1', 'b1', 'weight_reps', { loadKg: 80, reps: 8 })],
    )
    expect(lastPerformance(d, ATHLETE, 'ex-bench', 'cur')?.authorName).toBe('Νίκος')
  })

  it('prefers a session earlier the SAME day over one from last week', () => {
    // The prototype required a strictly earlier date string and only fell back to a
    // same-day session arbitrarily, so the morning slot was skipped.
    const d = build(
      [
        session('lastweek', '2026-08-05', '2026-08-05T08:00:00Z'),
        session('morning', '2026-08-12', '2026-08-12T08:00:00Z'),
        session('evening', '2026-08-12', '2026-08-12T18:00:00Z'),
      ],
      [
        block('b1', 'lastweek', 'ex-bench'),
        block('b2', 'morning', 'ex-bench'),
        block('b3', 'evening', 'ex-bench'),
      ],
      [
        wset('t1', 'b1', 'weight_reps', { loadKg: 70, reps: 8 }),
        wset('t2', 'b2', 'weight_reps', { loadKg: 75, reps: 8 }),
        wset('t3', 'b3', 'weight_reps', { loadKg: 80, reps: 8 }),
      ],
    )
    expect(lastPerformance(d, ATHLETE, 'ex-bench', 'evening')?.loadKg).toBe(75)
    expect(lastPerformance(d, ATHLETE, 'ex-bench', 'morning')?.loadKg).toBe(70)
  })

  it('never surfaces a session that comes after the one being edited', () => {
    // A trainer back-filling a missed workout writes a row whose startedAt is older than
    // an already-logged one; the prototype's date-string scan handed back the newer.
    const d = build(
      [
        session('older', '2026-08-12', '2026-08-12T08:00:00Z'),
        session('newer', '2026-08-19', '2026-08-19T08:00:00Z'),
      ],
      [block('b1', 'older', 'ex-bench'), block('b2', 'newer', 'ex-bench')],
      [
        wset('t1', 'b1', 'weight_reps', { loadKg: 70, reps: 8 }),
        wset('t2', 'b2', 'weight_reps', { loadKg: 90, reps: 8 }),
      ],
    )
    expect(lastPerformance(d, ATHLETE, 'ex-bench', 'older')).toBeNull()
    expect(lastPerformance(d, ATHLETE, 'ex-bench', 'newer')?.loadKg).toBe(70)
  })

  it('skips over sessions that did not include the exercise', () => {
    const d = build(
      [
        session('s1', '2026-08-05', '2026-08-05T08:00:00Z'),
        session('s2', '2026-08-12', '2026-08-12T08:00:00Z'),
        session('cur', '2026-08-19', '2026-08-19T08:00:00Z'),
      ],
      [block('b1', 's1', 'ex-bench'), block('b2', 's2', 'ex-run')],
      [
        wset('t1', 'b1', 'weight_reps', { loadKg: 70, reps: 8 }),
        wset('t2', 'b2', 'distance', { meters: 5000 }),
      ],
    )
    expect(lastPerformance(d, ATHLETE, 'ex-bench', 'cur')?.date).toBe('2026-08-05')
  })

  it('picks the top set by what the kind actually measures', () => {
    const d = build(
      [
        session('prev', '2026-08-12', '2026-08-12T08:00:00Z'),
        session('cur', '2026-08-19', '2026-08-19T08:00:00Z'),
      ],
      [block('b1', 'prev', 'ex-run')],
      [
        wset('t1', 'b1', 'distance', { meters: 3000 }),
        wset('t2', 'b1', 'distance', { meters: 5000 }),
      ],
    )
    expect(lastPerformance(d, ATHLETE, 'ex-run', 'cur')).toMatchObject({
      kind: 'distance',
      meters: 5000,
    })
  })

  it('falls back to the latest session when there is no current one yet', () => {
    const d = build(
      [session('prev', '2026-08-12', '2026-08-12T08:00:00Z')],
      [block('b1', 'prev', 'ex-bench')],
      [wset('t1', 'b1', 'weight_reps', { loadKg: 80, reps: 8 })],
    )
    expect(lastPerformance(d, ATHLETE, 'ex-bench', null)?.loadKg).toBe(80)
    // An unsaved session id is not in the list; everything logged is still a candidate.
    expect(lastPerformance(d, ATHLETE, 'ex-bench', 'unsaved')?.loadKg).toBe(80)
  })

  it('returns null when the athlete has never done the exercise', () => {
    const d = build(
      [session('cur', '2026-08-19', '2026-08-19T08:00:00Z')],
      [block('b1', 'cur', 'ex-bench')],
      [wset('t1', 'b1', 'weight_reps', { loadKg: 80, reps: 8 })],
    )
    expect(lastPerformance(d, ATHLETE, 'ex-bench', 'cur')).toBeNull()
  })

  it('leaves the author null when the roster was not supplied', () => {
    const d: AnalyticsData = {
      exercises: [bench],
      sessions: [
        session('prev', '2026-08-12', '2026-08-12T08:00:00Z'),
        session('cur', '2026-08-19', '2026-08-19T08:00:00Z'),
      ],
      blocks: [block('b1', 'prev', 'ex-bench')],
      sets: [wset('t1', 'b1', 'weight_reps', { loadKg: 80, reps: 8 })],
    }
    expect(lastPerformance(d, ATHLETE, 'ex-bench', 'cur')?.authorName).toBeNull()
  })
})
