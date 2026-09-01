import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import type { Locale } from '@/domain/format'
import { el, type Translation } from '@/i18n/el'
import { en } from '@/i18n/en'

export type { Translation }
/** Re-exported so a screen needs one import for "which language am I in" and its formatters. */
export type { Locale }

/**
 * i18n setup.
 *
 * **Greek is the default and English is the fallback**, which is the opposite of the design
 * prototype. That is not a preference: the gym is in Athens, the trainers type in Greek, and
 * a missing Greek string must be visible as an English word rather than an English UI being
 * the normal state.
 *
 * Plurals come from `Intl.PluralRules` via i18next's `_one` / `_other` suffixes (JSON v4, the
 * default in i18next v24). Nothing in the app may build a plural by string concatenation.
 */

export const DEFAULT_LOCALE: Locale = 'el'
export const FALLBACK_LOCALE: Locale = 'en'
export const LOCALES: readonly Locale[] = ['el', 'en']

const STORAGE_KEY = 'trainhub.locale'
const NAMESPACE = 'translation'

function isLocale(value: unknown): value is Locale {
  return value === 'el' || value === 'en'
}

/**
 * Every localStorage touch is wrapped, including the property read: in Safari private mode and
 * under a "block all cookies" policy the accessor itself throws, not just `getItem`.
 */
function readStoredLocale(): Locale | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return isLocale(raw) ? raw : null
  } catch {
    return null
  }
}

function writeStoredLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // The choice is lost on reload and the app opens in Greek again. Not worth a message.
  }
}

/**
 * The language the app opens in: whatever the trainer last chose, and Greek otherwise.
 *
 * `navigator.language` is deliberately NOT consulted. The gym is in Athens and the sheet is
 * written in Greek; a phone set to English says something about the phone, not about the
 * language the coaching happens in, and half the staff would get an English UI for a Greek
 * roster. English is a choice someone makes in Settings, not a default they fall into.
 */
export function initialLocale(): Locale {
  return readStoredLocale() ?? DEFAULT_LOCALE
}

export const i18n = i18next.createInstance()

void i18n.use(initReactI18next).init({
  resources: {
    el: { [NAMESPACE]: el },
    en: { [NAMESPACE]: en },
  },
  lng: initialLocale(),
  fallbackLng: FALLBACK_LOCALE,
  supportedLngs: [...LOCALES],
  defaultNS: NAMESPACE,
  ns: [NAMESPACE],
  // React escapes on render; letting i18next escape too turns an athlete called "O'Brien"
  // into "O&#39;Brien" on screen.
  interpolation: { escapeValue: false },
  // A missing key must be loud in development and silent-but-English in production.
  returnEmptyString: false,
})

/**
 * Keeps `<html lang>` in step with the UI language. It is not cosmetic: it is what makes a
 * screen reader pronounce "προπόνηση" as Greek rather than spelling it out, and what picks the
 * right hyphenation for long Greek exercise names.
 */
function applyDocumentLang(locale: string): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
}

i18n.on('languageChanged', applyDocumentLang)
applyDocumentLang(i18n.language || DEFAULT_LOCALE)

export function currentLocale(): Locale {
  return isLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE
}

export async function setLocale(next: Locale): Promise<void> {
  writeStoredLocale(next)
  await i18n.changeLanguage(next)
}

// ---------------------------------------------------------------------------
// Key typing
// ---------------------------------------------------------------------------

type Leaf = string | number | boolean | null | undefined

/** Dotted paths to every leaf of the resource tree, e.g. `settings.theme`, `counts.set_one`. */
type PathsOf<T> = T extends Leaf
  ? never
  : {
      [K in keyof T & string]: T[K] extends Leaf ? K : `${K}.${PathsOf<T[K]>}`
    }[keyof T & string]

/**
 * A counted key is CALLED by its base name — `t('counts.session', { count })` — and i18next
 * appends the CLDR category itself. Folding the suffixed variants back onto their base is what
 * stops `t('counts.session_other')` from typechecking, which is the call that produces
 * "1 προπονήσεις".
 */
type StripPluralSuffix<K extends string> = K extends `${infer Base}_zero`
  ? Base
  : K extends `${infer Base}_one`
    ? Base
    : K extends `${infer Base}_two`
      ? Base
      : K extends `${infer Base}_few`
        ? Base
        : K extends `${infer Base}_many`
          ? Base
          : K extends `${infer Base}_other`
            ? Base
            : K

/** Every key `t()` accepts. Exported so other modules can type a key they pass around. */
export type TranslationKey = StripPluralSuffix<PathsOf<Translation>>

/**
 * Makes the union above the type of `t()` everywhere, so a misspelled or removed key is a
 * compile error instead of the raw key rendered on a trainer's screen.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof NAMESPACE
    resources: { translation: Translation }
    returnNull: false
  }
}
