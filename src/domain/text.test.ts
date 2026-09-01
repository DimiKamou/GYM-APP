import { describe, expect, it } from 'vitest'
import { initials, matches, normalizeText, stripDiacritics } from '@/domain/text'

describe('stripDiacritics', () => {
  it('drops Greek accents and keeps case', () => {
    expect(stripDiacritics('Πιέσεις')).toBe('Πιεσεις')
    expect(stripDiacritics('Άννα')).toBe('Αννα')
    expect(stripDiacritics('ΠΙΈΣΕΙΣ')).toBe('ΠΙΕΣΕΙΣ')
  })

  it('handles the dialytika-plus-tonos vowels', () => {
    expect(stripDiacritics('προϊόν')).toBe('προιον')
    expect(stripDiacritics('Ϊ')).toBe('Ι')
  })

  it('leaves Latin and unaccented text alone', () => {
    expect(stripDiacritics('Bench Press')).toBe('Bench Press')
    expect(stripDiacritics('')).toBe('')
  })
})

describe('normalizeText', () => {
  it('folds accents, case and the final sigma into one comparison form', () => {
    // The fold ends in a medial sigma: that is what makes the three forms one string.
    expect(normalizeText('Πιέσεις')).toBe('πιεσεισ')
    expect(normalizeText('ΠΙΈΣΕΙΣ')).toBe('πιεσεισ')
    expect(normalizeText('πιεσεις')).toBe('πιεσεισ')
  })

  it('folds ς and σ, so a name typed mid-word matches one typed at the end', () => {
    expect(normalizeText('Παπαδάκης')).toBe(normalizeText('παπαδακησ'))
    expect(normalizeText('Παπαδάκης')).toBe('παπαδακησ')
    expect(normalizeText('ΠΑΠΑΔΑΚΗΣ')).toBe('παπαδακησ')
  })

  it('collapses and trims whitespace', () => {
    expect(normalizeText('  Άννα   Παπαδάκη  ')).toBe('αννα παπαδακη')
  })
})

describe('matches', () => {
  it('finds an accented name from an unaccented query', () => {
    expect(matches('Πιέσεις πάγκου', 'πιεσεις')).toBe(true)
    expect(matches('ΠΙΈΣΕΙΣ ΠΑΓΚΟΥ', 'πιεσεις')).toBe(true)
    expect(matches('Πιέσεις πάγκου', 'ΠΙΕΣΕΙΣ')).toBe(true)
  })

  it('matches across the final sigma', () => {
    expect(matches('Άννα Παπαδάκης', 'παπαδακησ')).toBe(true)
    expect(matches('Άννα Παπαδάκης', 'ΠΑΠΑΔΑΚΗΣ')).toBe(true)
  })

  it('matches tokens in any order, because coaches search by surname first', () => {
    expect(matches('Άννα Παπαδάκη', 'παπ αννα')).toBe(true)
    expect(matches('Άννα Παπαδάκη', 'αννα παπ')).toBe(true)
  })

  it('is false when a token is absent', () => {
    expect(matches('Άννα Παπαδάκη', 'γιωργος')).toBe(false)
    expect(matches('Άννα Παπαδάκη', 'αννα γιωργος')).toBe(false)
  })

  it('treats an empty query as no filter', () => {
    expect(matches('Άννα Παπαδάκη', '')).toBe(true)
    expect(matches('Άννα Παπαδάκη', '   ')).toBe(true)
  })

  it('works on Latin text too', () => {
    expect(matches('Bench Press', 'bench')).toBe(true)
    expect(matches('Bench Press', 'BENCH press')).toBe(true)
  })
})

describe('initials', () => {
  it('gives Greek two-letter initials without accents', () => {
    expect(initials('Άννα Παπαδάκη')).toBe('ΑΠ')
    expect(initials('Γιώργος Οικονόμου')).toBe('ΓΟ')
    expect(initials('Ελένη Ίσαρη')).toBe('ΕΙ')
  })

  it('ignores a middle name and extra whitespace', () => {
    expect(initials('  Άννα   Μαρία Παπαδάκη ')).toBe('ΑΜ')
  })

  it('handles a single name and Latin names', () => {
    expect(initials('Άννα')).toBe('Α')
    expect(initials('Maria Rossi')).toBe('MR')
  })

  it('skips punctuation and survives an empty name', () => {
    expect(initials('(Άννα) Παπαδάκη')).toBe('ΑΠ')
    expect(initials('')).toBe('')
    expect(initials('   ')).toBe('')
    expect(initials('- -')).toBe('')
  })
})
