import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { el } from './el'
import { en } from './en'

/**
 * `TranslationKey` folds `_one`/`_other` away, so a plural suffix cannot be assigned to that
 * type by hand. `t()` is a different matter: i18next's own signature re-expands the suffixes,
 * because they are legitimate keys for it to resolve. So `t('counts.session_other')` compiles,
 * and it renders the plural form unconditionally — "1 προπονήσεις" — silently defeating the
 * count logic it looks like it is using. The type cannot catch it; this can.
 */

// Vitest runs from the repo root; import.meta.url is not a file URL under jsdom.
const SRC = resolve(process.cwd(), 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : []
  })
}

/** `t('some.key')` / `t("some.key")` — the literal-key call, which is the only one we can check. */
const T_CALL = /\bt\(\s*['"]([^'"]+)['"]/g

/** Comments discuss these keys by name — including the doc comment on StripPluralSuffix. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('no caller reaches past the plural machinery', () => {
  it('never passes a plural-suffixed key to t()', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      for (const [, key] of stripComments(readFileSync(file, 'utf8')).matchAll(T_CALL)) {
        if (/_(one|two|few|many|other|zero)$/.test(key)) {
          offenders.push(`${file.slice(SRC.length + 1)}: t('${key}')`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

/**
 * Greek and English must agree on structure. A key present in one and missing from the other
 * renders the raw dotted path on a trainer's screen, which is worse than an English fallback
 * because it does not look like text at all.
 */
describe('the two locales stay in step', () => {
  function paths(value: unknown, prefix = ''): string[] {
    if (typeof value !== 'object' || value === null) return [prefix]
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      paths(v, prefix ? `${prefix}.${k}` : k),
    )
  }

  it('define exactly the same keys', () => {
    const elKeys = paths(el).sort()
    const enKeys = paths(en).sort()
    expect(elKeys.filter((k) => !enKeys.includes(k))).toEqual([])
    expect(enKeys.filter((k) => !elKeys.includes(k))).toEqual([])
  })

  it('has Greek as the primary locale, not the fallback', () => {
    // The prototype had this backwards. Greek trainers are the users; English is the courtesy.
    expect(paths(el).length).toBeGreaterThan(0)
    expect(paths(el).length).toBe(paths(en).length)
  })
})
