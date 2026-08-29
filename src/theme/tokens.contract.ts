/**
 * The theme contract.
 *
 * Every theme file must define exactly this set of custom properties — no more, no fewer.
 * Two themes maintained by hand drift within a week: one gains a token the other lacks, a screen
 * uses it, and the other theme falls back to whatever the browser inherits. `theme.test.ts`
 * parses both CSS files off disk and diffs them against this array, so the drift fails CI
 * instead of shipping as an invisible colour bug on half the devices.
 *
 * Names are grouped for the same reason they are grouped in the CSS: a group is what you add to
 * when a new concept appears, and a group with one theme's worth of entries is obviously wrong.
 */

export const THEME_TOKEN_GROUPS = {
  surfaces: [
    '--th-bg',
    '--th-bg-image',
    '--th-surface',
    '--th-surface-2',
    '--th-surface-3',
    '--th-ink',
    '--th-muted',
    '--th-faint',
    '--th-line',
    '--th-line-soft',
  ],
  accent: ['--th-accent', '--th-accent-ink', '--th-accent-soft'],
  avatar: ['--th-avatar-bg', '--th-avatar-ink'],
  semantic: [
    '--th-danger',
    '--th-danger-ink',
    '--th-danger-soft',
    '--th-success',
    '--th-warning',
  ],
  category: [
    '--th-cat-upper',
    '--th-cat-lower',
    '--th-cat-core',
    '--th-cat-cardio',
    '--th-cat-mobility',
  ],
  appointment: [
    '--th-appt-personal',
    '--th-appt-assessment',
    '--th-appt-group',
    '--th-appt-program',
  ],
  type: [
    '--th-font-display',
    '--th-font-ui',
    '--th-display-weight',
    '--th-display-tracking',
  ],
  elevation: ['--th-shadow', '--th-shadow-soft'],
  chrome: ['--th-theme-color'],
} as const

export type ThemeTokenGroup = keyof typeof THEME_TOKEN_GROUPS
export type ThemeToken =
  (typeof THEME_TOKEN_GROUPS)[ThemeTokenGroup][number]

/** Flat, frozen list of every required custom property. */
export const THEME_TOKENS: readonly ThemeToken[] = Object.freeze(
  Object.values(THEME_TOKEN_GROUPS).flat() as ThemeToken[],
)

/** Maps an `ExerciseCategory` to its per-theme token. */
export const CATEGORY_TOKEN = Object.freeze({
  upper: '--th-cat-upper',
  lower: '--th-cat-lower',
  core: '--th-cat-core',
  cardio: '--th-cat-cardio',
  mobility: '--th-cat-mobility',
} as const)

/** Maps an `AppointmentType` to its per-theme token. */
export const APPOINTMENT_TOKEN = Object.freeze({
  personal: '--th-appt-personal',
  assessment: '--th-appt-assessment',
  group: '--th-appt-group',
  program: '--th-appt-program',
} as const)

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

/** WCAG 2.1 minimum for body-sized text. */
export const CONTRAST_AA = 4.5

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1]
  const full =
    h.length === 3
      ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
      : h
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ]
}

/** WCAG 2.1 relative luminance. Returns null for anything that is not a plain hex colour. */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  ) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 contrast ratio, 1..21. Returns null if either colour is unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  if (la === null || lb === null) return null
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Pick the more legible of two inks for a background.
 *
 * The prototype did this as `lum(bg) > 0.45 ? dark : white`. 0.45 is not the crossover — for a
 * white/near-black pair it sits near 0.179 — and the error is not cosmetic: it put white on
 * Slate's accent #84A0D6 at 2.63:1, where the dark ink measures 6.86:1. There is no threshold
 * that is right for every hue, so this compares the two ratios it actually cares about.
 *
 * Only for colours chosen at runtime (a trainer's avatar tint, a chart series). The themes' own
 * `--th-accent-ink` is a reviewed constant, not this function's output.
 */
export function pickInkOn(
  background: string,
  darkInk = '#14161E',
  lightInk = '#FBF8F1',
): string {
  const dark = contrastRatio(darkInk, background)
  const light = contrastRatio(lightInk, background)
  if (dark === null || light === null) return darkInk
  return dark >= light ? darkInk : lightInk
}
