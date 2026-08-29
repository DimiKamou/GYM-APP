/**
 * Greek text folding.
 *
 * Every search box in this app is used by a coach with a phone in one hand and a
 * dumbbell rack in the other: they type "πιεσεις", never "Πιέσεις". Two Greek-specific
 * rules make that work, and both have to be applied everywhere or the roster search and
 * the exercise picker disagree about the same name.
 */

/** Combining diacritical marks — everything NFD peels off a Greek accented vowel. */
const COMBINING_MARKS = /[\u0300-\u036f]/g

/**
 * Decomposes and drops accent marks, preserving case. "Πιέσεις" -> "Πιεσεις",
 * "Άννα" -> "Αννα".
 */
export function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(COMBINING_MARKS, '').normalize('NFC')
}

/**
 * The canonical comparison form: accentless, lowercase, final sigma folded, whitespace
 * collapsed. `ExerciseAlias.normAlias` is exactly this, so an alias written by one
 * trainer is found by another typing it differently.
 *
 * The final sigma matters as much as the accents: JS lowercases "ΠΑΠΑΔΑΚΗΣ" to
 * "παπαδακης" with U+03C2, while a coach typing the name mid-word produces U+03C3.
 * Without this fold those two strings are simply different names.
 */
export function normalizeText(input: string): string {
  return stripDiacritics(input)
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Case- and diacritic-insensitive containment.
 *
 * Multi-word needles match token-wise rather than as one substring, so "παπ αννα"
 * finds "Άννα Παπαδάκη" — a coach searching a roster types the surname first about half
 * the time.
 */
export function matches(haystack: string, needle: string): boolean {
  const target = normalizeText(needle)
  if (target === '') return true
  const source = normalizeText(haystack)
  return target.split(' ').every((token) => source.includes(token))
}

/**
 * Avatar initials, Greek convention: first letter of the first two words, accentless and
 * uppercased. "Άννα Παπαδάκη" -> "ΑΠ".
 *
 * Accents are stripped BEFORE uppercasing because Greek capitals are written without
 * them — uppercasing first would render "ΆΠ".
 */
export function initials(fullName: string): string {
  const letters: string[] = []
  for (const word of stripDiacritics(fullName).split(/\s+/)) {
    // Skip whatever punctuation a nickname was written in: "(Άννα)" still gives "Α".
    const first = Array.from(word).find((ch) => /[\p{L}\p{N}]/u.test(ch))
    if (first === undefined) continue
    letters.push(first.toUpperCase())
    if (letters.length === 2) break
  }
  return letters.join('')
}
