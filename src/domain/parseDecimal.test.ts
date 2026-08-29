import { describe, expect, it } from 'vitest'
import { parseDecimal, parseReps, parseWeightKg, WEIGHT_RANGE } from '@/domain/parseDecimal'

describe('parseDecimal', () => {
  it('accepts the Greek comma, which is what the keyboard actually produces', () => {
    expect(parseDecimal('72,5')).toBe(72.5)
  })

  it('accepts the dot too, so a pasted or English-keyboard value still lands', () => {
    expect(parseDecimal('72.5')).toBe(72.5)
  })

  it('tolerates whitespace and a unit suffix', () => {
    expect(parseDecimal(' 72,5 kg ')).toBe(72.5)
    expect(parseDecimal('72,5κιλά')).toBe(72.5)
    expect(parseDecimal('100 kg.')).toBe(100)
    expect(parseDecimal('5 χλμ', { max: 100 })).toBe(5)
  })

  it('parses plain integers and bare separators', () => {
    expect(parseDecimal('80')).toBe(80)
    expect(parseDecimal(',5')).toBe(0.5)
    expect(parseDecimal('5,')).toBe(5)
    expect(parseDecimal('0')).toBe(0)
  })

  it('never returns NaN — the whole point of the module', () => {
    for (const bad of ['', '   ', 'abc', 'kg', ',', '.', '-', '7,2,3', '1..2', 'κιλά']) {
      expect(parseDecimal(bad), bad).toBeNull()
    }
  })

  it('rejects negatives rather than storing them', () => {
    expect(parseDecimal('-5')).toBeNull()
    expect(parseDecimal('−5')).toBeNull() // U+2212, what iOS types
    expect(parseDecimal('-5', { min: -100 })).toBe(-5)
  })

  it('rejects exponent notation instead of guessing at it', () => {
    expect(parseDecimal('1e3')).toBeNull()
    expect(parseDecimal('1E3')).toBeNull()
  })

  it('reads Arabic-Indic digits', () => {
    expect(parseDecimal('٧٢')).toBe(72)
    expect(parseDecimal('٧٢٫٥')).toBe(72.5)
    expect(parseDecimal('۷۲')).toBe(72) // extended Arabic-Indic
  })

  it('resolves thousands separators by taking the last separator as the decimal one', () => {
    expect(parseDecimal('1.234,5', { max: 10_000 })).toBe(1234.5)
    expect(parseDecimal('1,234.5', { max: 10_000 })).toBe(1234.5)
    expect(parseDecimal('1 234,5', { max: 10_000 })).toBe(1234.5)
    expect(parseDecimal('1.234.567', { max: 10_000_000 })).toBe(1234567)
  })

  it('rejects malformed grouping', () => {
    expect(parseDecimal('1.23.456', { max: 10_000_000 })).toBeNull()
    expect(parseDecimal('12.34,5', { max: 10_000 })).toBeNull()
  })

  it('treats a lone separator as decimal, because 72,500 kg is not a weight', () => {
    expect(parseDecimal('72,500')).toBe(72.5)
  })

  it('rejects out-of-range values rather than clamping them into storage', () => {
    expect(parseDecimal(String(WEIGHT_RANGE.max + 1))).toBeNull()
    expect(parseDecimal('99999')).toBeNull()
    expect(parseDecimal('1500', { max: 2000 })).toBe(1500)
  })

  it('passes finite numbers through and rejects non-strings', () => {
    expect(parseDecimal(72.5)).toBe(72.5)
    expect(parseDecimal(Number.NaN)).toBeNull()
    expect(parseDecimal(Infinity)).toBeNull()
    expect(parseDecimal(null)).toBeNull()
    expect(parseDecimal(undefined)).toBeNull()
    expect(parseDecimal({})).toBeNull()
  })
})

describe('parseWeightKg', () => {
  it('uses the weight range by default', () => {
    expect(parseWeightKg('72,5')).toBe(72.5)
    expect(parseWeightKg('1,25')).toBe(1.25)
    expect(parseWeightKg('2000')).toBeNull()
  })
})

describe('parseReps', () => {
  it('takes whole reps only', () => {
    expect(parseReps('8')).toBe(8)
    expect(parseReps('8,5')).toBeNull()
    expect(parseReps('0')).toBe(0)
    expect(parseReps('-1')).toBeNull()
    expect(parseReps('abc')).toBeNull()
  })
})
