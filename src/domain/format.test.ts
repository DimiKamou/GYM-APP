import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  formatDate,
  formatLastPerformance,
  formatSet,
  formatVolume,
  formatWeight,
  type SetLike,
} from '@/domain/format'
import type { LastPerformance, SetKind } from '@/domain/types'

function set(kind: SetKind, fields: Partial<SetLike> = {}): SetLike {
  return { kind, loadKg: null, reps: null, seconds: null, meters: null, ...fields }
}

describe('formatVolume', () => {
  it('prints whole kilos below a tonne', () => {
    expect(formatVolume(640)).toBe('640')
    expect(formatVolume(587.5)).toBe('588')
    expect(formatVolume(0)).toBe('0')
  })

  it('switches to the k-suffix at 1000', () => {
    expect(formatVolume(1000)).toBe('1k')
    expect(formatVolume(12000)).toBe('12k')
    expect(formatVolume(12345)).toBe('12,3k')
  })

  it('uses a dot for the k-suffix decimal in English', () => {
    expect(formatVolume(12345, 'en')).toBe('12.3k')
  })

  it('never renders NaN or a negative', () => {
    expect(formatVolume(Number.NaN)).toBe('0')
    expect(formatVolume(-10)).toBe('0')
  })
})

describe('formatDate', () => {
  it('renders a short Greek date', () => {
    expect(formatDate('2026-08-12')).toBe('12 Αυγ')
  })

  it('renders English on request', () => {
    expect(formatDate('2026-08-12', 'en')).toBe('12 Aug')
  })

  it('can include the year', () => {
    expect(formatDate('2026-08-12', 'el', { withYear: true })).toBe('12 Αυγ 2026')
  })

  it('does not shift the day for a browser west of Greenwich', () => {
    // A LocalDate is a calendar date. Parsed as an instant it would render as the 1st
    // of the previous month in any negative-offset timezone.
    expect(formatDate('2026-01-01')).toBe('1 Ιαν')
    expect(formatDate('2026-12-31')).toBe('31 Δεκ')
  })

  it('returns the raw value rather than throwing on rubbish', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date')
    expect(formatDate('')).toBe(EMPTY)
  })
})

describe('formatWeight', () => {
  it('uses a decimal comma in Greek', () => {
    expect(formatWeight(72.5)).toBe('72,5')
    expect(formatWeight(1.25)).toBe('1,25')
    expect(formatWeight(80)).toBe('80')
  })

  it('uses a decimal point in English', () => {
    expect(formatWeight(72.5, 'en')).toBe('72.5')
  })

  it('can append the unit', () => {
    expect(formatWeight(72.5, 'el', { unit: true })).toBe('72,5 kg')
  })

  it('renders a dash for a missing weight, never 0 and never NaN', () => {
    expect(formatWeight(null)).toBe(EMPTY)
    expect(formatWeight(undefined)).toBe(EMPTY)
    expect(formatWeight(Number.NaN)).toBe(EMPTY)
  })
})

describe('formatSet', () => {
  it('renders a loaded set as kg×reps', () => {
    expect(formatSet(set('weight_reps', { loadKg: 80, reps: 8 }))).toBe('80×8')
    expect(formatSet(set('weight_reps', { loadKg: 72.5, reps: 8 }))).toBe('72,5×8')
    expect(formatSet(set('weight_reps', { loadKg: 72.5, reps: 8 }), 'weight_reps', 'en')).toBe(
      '72.5×8',
    )
  })

  it('falls back when half a loaded set was recorded', () => {
    expect(formatSet(set('weight_reps', { loadKg: 80 }))).toBe('80 kg')
    expect(formatSet(set('weight_reps', { reps: 8 }))).toBe('8 επαναλήψεις')
    expect(formatSet(set('weight_reps'))).toBe(EMPTY)
  })

  it('renders bodyweight as reps', () => {
    expect(formatSet(set('bodyweight', { reps: 10 }))).toBe('10 επαναλήψεις')
    expect(formatSet(set('bodyweight', { reps: 10 }), 'bodyweight', 'en')).toBe('10 reps')
  })

  it('marks added load on a bodyweight movement', () => {
    expect(formatSet(set('bodyweight', { reps: 8, loadKg: 10 }))).toBe('+10×8')
  })

  it('renders duration in minutes, seconds, or a clock', () => {
    expect(formatSet(set('duration', { seconds: 1200 }))).toBe('20 λεπτά')
    expect(formatSet(set('duration', { seconds: 60 }))).toBe('1 λεπτό')
    expect(formatSet(set('duration', { seconds: 45 }))).toBe('45 δευτ.')
    expect(formatSet(set('duration', { seconds: 90 }))).toBe('1:30')
    expect(formatSet(set('duration', { seconds: 1200 }), 'duration', 'en')).toBe('20 min')
  })

  it('renders distance in km above a kilometre, metres below', () => {
    expect(formatSet(set('distance', { meters: 5000 }))).toBe('5,0 χλμ')
    expect(formatSet(set('distance', { meters: 5500 }))).toBe('5,5 χλμ')
    expect(formatSet(set('distance', { meters: 800 }))).toBe('800 μ.')
    expect(formatSet(set('distance', { meters: 5000 }), 'distance', 'en')).toBe('5.0 km')
  })

  it('renders a dash instead of a bare number when the measurement is missing', () => {
    expect(formatSet(set('duration'))).toBe(EMPTY)
    expect(formatSet(set('distance'))).toBe(EMPTY)
    expect(formatSet(set('bodyweight'))).toBe(EMPTY)
  })

  it('takes an explicit kind, so a target renders with the performance code', () => {
    // A prescribed row can carry numbers its stored kind does not render; the caller
    // says which shape it wants rather than reaching for a second formatter.
    const row = set('duration', { loadKg: 80, reps: 8, seconds: 600 })
    expect(formatSet(row)).toBe('10 λεπτά')
    expect(formatSet(row, 'weight_reps')).toBe('80×8')
  })
})

describe('formatLastPerformance', () => {
  const last: LastPerformance = {
    kind: 'weight_reps',
    loadKg: 80,
    reps: 8,
    seconds: null,
    meters: null,
    date: '2026-08-12',
    authorName: 'Μαρία',
  }

  it('renders the number with its date and author', () => {
    expect(formatLastPerformance(last)).toBe('80×8 · 12 Αυγ · Μαρία')
  })

  it('drops the author only when there genuinely is not one', () => {
    expect(formatLastPerformance({ ...last, authorName: null })).toBe('80×8 · 12 Αυγ')
  })
})
