import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_TOKEN,
  CONTRAST_AA,
  THEME_TOKENS,
  THEME_TOKEN_GROUPS,
  contrastRatio,
  pickInkOn,
} from './tokens.contract'

/**
 * The anti-drift test. It reads the theme CSS as text rather than through a DOM, because jsdom
 * does not apply stylesheets — a getComputedStyle-based check would pass against two empty files.
 */

const THEME_FILES = {
  daylight: '../styles/themes/daylight.css',
  slate: '../styles/themes/slate.css',
} as const

type ThemeName = keyof typeof THEME_FILES

function readTheme(name: ThemeName): string {
  return readFileSync(fileURLToPath(new URL(THEME_FILES[name], import.meta.url)), 'utf8')
}

/**
 * Declarations only. `var(--th-x)` is not followed by a colon, so a usage can never be mistaken
 * for a definition; comments are stripped first so the documented ratios do not register.
 */
function parseDeclarations(css: string): Array<[string, string]> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Array<[string, string]> = []
  for (const m of withoutComments.matchAll(/(--th-[a-z0-9-]+)\s*:\s*([^;{}]*)/g)) {
    out.push([m[1], m[2].trim()])
  }
  return out
}

const PARSED: Record<ThemeName, Array<[string, string]>> = {
  daylight: parseDeclarations(readTheme('daylight')),
  slate: parseDeclarations(readTheme('slate')),
}

describe('theme contract', () => {
  it('lists every token exactly once', () => {
    expect(new Set(THEME_TOKENS).size).toBe(THEME_TOKENS.length)
  })

  it('is frozen', () => {
    expect(Object.isFrozen(THEME_TOKENS)).toBe(true)
  })

  it('groups account for every token', () => {
    const grouped = Object.values(THEME_TOKEN_GROUPS).flat()
    expect([...grouped].sort()).toEqual([...THEME_TOKENS].sort())
  })

  it('parses at least one declaration per file', () => {
    // Guards the regex itself: a parser that silently matches nothing would make every
    // "no extra keys" assertion below vacuously true.
    expect(PARSED.daylight.length).toBeGreaterThan(0)
    expect(PARSED.slate.length).toBeGreaterThan(0)
  })
})

describe.each(Object.keys(THEME_FILES) as ThemeName[])('%s.css', (name) => {
  const declared = PARSED[name]
  const names = declared.map(([prop]) => prop)

  it('defines every contract token', () => {
    const missing = THEME_TOKENS.filter((token) => !names.includes(token))
    expect(missing).toEqual([])
  })

  it('defines nothing outside the contract', () => {
    const contract = new Set<string>(THEME_TOKENS)
    const extra = names.filter((prop) => !contract.has(prop))
    expect(extra).toEqual([])
  })

  it('declares each token once', () => {
    const seen = new Set<string>()
    const duplicates = names.filter((prop) => !seen.add(prop))
    expect(duplicates).toEqual([])
  })

  it('leaves no value empty', () => {
    const empty = declared.filter(([, value]) => value.length === 0).map(([prop]) => prop)
    expect(empty).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The two corrections to the prototype. These assertions are the reason the fixes
// survive the next person who "restores the original palette".
// ---------------------------------------------------------------------------

function tokenValue(name: ThemeName, token: string): string {
  const hit = PARSED[name].find(([prop]) => prop === token)
  if (!hit) throw new Error(`${token} missing from ${name}.css`)
  return hit[1]
}

describe('correction 1 — accent ink is measured, not thresholded', () => {
  it.each(['daylight', 'slate'] as const)('%s accent ink clears AA', (name) => {
    const ratio = contrastRatio(tokenValue(name, '--th-accent-ink'), tokenValue(name, '--th-accent'))
    expect(ratio).not.toBeNull()
    expect(ratio as number).toBeGreaterThanOrEqual(CONTRAST_AA)
  })

  it('rejects the white-on-slate-accent the luminance threshold produced', () => {
    expect(contrastRatio('#FFFFFF', '#84A0D6') as number).toBeLessThan(CONTRAST_AA)
    expect(pickInkOn('#84A0D6')).toBe('#14161E')
  })

  it('still picks light ink where light ink genuinely wins', () => {
    expect(pickInkOn('#5E7355')).toBe('#FBF8F1')
  })
})

describe('correction 2 — category colours are legible on their own theme chip', () => {
  // The chip, not the card: it is the darker of the two on Daylight and the lighter on Slate,
  // so it is the surface each colour has to survive.
  it.each(['daylight', 'slate'] as const)('%s categories clear AA on --th-surface-3', (name) => {
    const chip = tokenValue(name, '--th-surface-3')
    for (const token of Object.values(CATEGORY_TOKEN)) {
      const ratio = contrastRatio(tokenValue(name, token), chip)
      expect(ratio, `${token} on ${chip}`).not.toBeNull()
      expect(ratio as number, `${token} on ${chip}`).toBeGreaterThanOrEqual(CONTRAST_AA)
    }
  })

  it('keeps the five categories distinguishable within a theme', () => {
    for (const name of ['daylight', 'slate'] as const) {
      const values = Object.values(CATEGORY_TOKEN).map((t) => tokenValue(name, t).toUpperCase())
      expect(new Set(values).size).toBe(values.length)
    }
  })
})

describe('theme text pairs', () => {
  it.each(['daylight', 'slate'] as const)('%s ink on surface clears AA', (name) => {
    for (const surface of ['--th-bg', '--th-surface', '--th-surface-2', '--th-surface-3']) {
      const ratio = contrastRatio(tokenValue(name, '--th-ink'), tokenValue(name, surface))
      expect(ratio as number, `ink on ${surface}`).toBeGreaterThanOrEqual(CONTRAST_AA)
    }
  })

  it.each(['daylight', 'slate'] as const)('%s avatar ink clears AA on its own chip', (name) => {
    const ratio = contrastRatio(tokenValue(name, '--th-avatar-ink'), tokenValue(name, '--th-avatar-bg'))
    expect(ratio as number).toBeGreaterThanOrEqual(CONTRAST_AA)
  })
})
