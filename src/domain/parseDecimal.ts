/**
 * Numeric input parsing for a Greek gym.
 *
 * A Greek keyboard puts the comma where the coach expects the decimal point, so the
 * single most common weight entry in this app is `72,5`. `Number("72,5")` is `NaN`,
 * and a NaN that reaches storage propagates through every sum, chart and CSV export
 * without ever surfacing as an error. Nothing here returns NaN: unparseable is `null`,
 * which a caller has to handle.
 */

/** Weights a barbell can actually hold. Anything outside is a typo, not a lift. */
export const WEIGHT_RANGE = { min: 0, max: 1000 } as const

export interface ParseDecimalOptions {
  /** Inclusive. Default 0 — a negative load is always a typo. */
  min?: number
  /** Inclusive. Default 1000 kg. */
  max?: number
}

/** Arabic-Indic and Extended Arabic-Indic digit blocks, plus their separators. */
const ARABIC_INDIC_ZERO = 0x0660
const EXT_ARABIC_INDIC_ZERO = 0x06f0

/**
 * Greek is written with ASCII digits, so only the Arabic blocks need folding — an
 * Arabic-speaking member typing on their own phone keyboard is the real case here.
 */
function normalizeDigits(input: string): string {
  let out = ''
  for (const ch of input) {
    const code = ch.codePointAt(0) as number
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO)
    } else if (code >= EXT_ARABIC_INDIC_ZERO && code <= EXT_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EXT_ARABIC_INDIC_ZERO)
    } else if (ch === '٫') {
      out += ',' // Arabic decimal separator
    } else if (ch === '٬') {
      out += '.' // Arabic thousands separator
    } else {
      out += ch
    }
  }
  return out
}

/**
 * Splits a digits-and-separators string into a plain `1234.5` form, or null if the
 * separators do not describe one number.
 */
function resolveSeparators(body: string): string | null {
  const hasDot = body.includes('.')
  const hasComma = body.includes(',')

  if (!hasDot && !hasComma) return body

  if (hasDot && hasComma) {
    // Both present means one of them groups thousands: whichever comes last is the
    // decimal point ("1.234,5" is Greek, "1,234.5" is English, both are 1234.5).
    const decimalSep = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ','
    const groupSep = decimalSep === '.' ? ',' : '.'
    const parts = body.split(decimalSep)
    if (parts.length !== 2) return null
    const intPart = parts[0].split(groupSep)
    if (!isValidGrouping(intPart)) return null
    if (parts[1].includes(groupSep)) return null
    return `${intPart.join('')}.${parts[1]}`
  }

  const sep = hasDot ? '.' : ','
  const parts = body.split(sep)
  if (parts.length === 2) {
    // A single separator is always the decimal point. "72,500" as seventy-two and a
    // half is a plausible entry; as 72500 kg it is not, so there is nothing to weigh up.
    return `${parts[0]}.${parts[1]}`
  }
  // Repeated separator can only be thousands grouping ("1.234.567").
  if (!isValidGrouping(parts)) return null
  return parts.join('')
}

function isValidGrouping(parts: string[]): boolean {
  if (parts.length === 1) return true
  if (parts[0].length < 1 || parts[0].length > 3) return false
  return parts.slice(1).every((p) => p.length === 3)
}

/**
 * Parses a human-typed decimal. Accepts `,` or `.`, Arabic-Indic digits, surrounding
 * whitespace and a trailing unit ("72,5 kg", "5 χλμ").
 *
 * Returns null — never NaN — for anything else, and for anything outside the range.
 * Out-of-range is rejected rather than clamped on purpose: silently storing 1000 for a
 * fat-fingered 10000 is the same class of bug as the NaN this function exists to stop.
 */
export function parseDecimal(input: unknown, options: ParseDecimalOptions = {}): number | null {
  const min = options.min ?? WEIGHT_RANGE.min
  const max = options.max ?? WEIGHT_RANGE.max

  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= min && input <= max ? input : null
  }
  if (typeof input !== 'string') return null

  let s = normalizeDigits(input)
  // Strip a trailing unit ("kg", "κιλά", "χλμ") and any trailing punctuation with it.
  s = s.replace(/[\p{L}\s.·]*$/u, '')
  s = s.trim()
  // A space or NBSP inside the number is a thousands group ("1 234,5").
  s = s.replace(/\s/gu, '')
  if (s === '') return null

  let sign = 1
  if (s.startsWith('-') || s.startsWith('−')) {
    sign = -1
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }

  // Only digits and separators survive. This is what rejects "1e3" and "abc": exponent
  // notation is never what a coach meant to type, so it is a typo, not a number.
  if (!/^[0-9.,]+$/.test(s)) return null
  if (!/[0-9]/.test(s)) return null

  const body = resolveSeparators(s)
  if (body === null) return null

  const value = Number(body)
  if (!Number.isFinite(value)) return null

  const signed = sign * value
  if (signed < min || signed > max) return null
  return signed
}

/** A load in kilograms. */
export function parseWeightKg(input: unknown): number | null {
  return parseDecimal(input)
}

/**
 * A repetition count. Whole numbers only — "8,5 reps" is a slip of the thumb, and
 * accepting it would put a fraction into every volume total downstream.
 */
export function parseReps(input: unknown): number | null {
  const value = parseDecimal(input, { min: 0, max: 999 })
  if (value === null || !Number.isInteger(value)) return null
  return value
}
