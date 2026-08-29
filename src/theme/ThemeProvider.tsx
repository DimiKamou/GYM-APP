import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/**
 * Theme state. Three preferences, two themes: `system` is a preference, never a rendered theme.
 * Keeping them as separate types is what stops a screen from ever branching on `'system'`.
 */
export type ThemePreference = 'system' | 'daylight' | 'slate'
export type ResolvedTheme = 'daylight' | 'slate'

const STORAGE_KEY = 'trainhub.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Fallback for the OS chrome colour when the stylesheet has not parsed yet (first paint, tests). */
const FALLBACK_THEME_COLOR: Record<ResolvedTheme, string> = {
  daylight: '#F4F0E7',
  slate: '#161922',
}

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'daylight' || value === 'slate'
}

/**
 * Every localStorage touch is wrapped, including the property read itself: in Safari private
 * mode and under a "block all cookies" policy, `window.localStorage` throws on *access*, not on
 * getItem. A trainer whose browser is locked down still gets a working app in the default theme.
 */
function readStoredPreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return isPreference(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

function writeStoredPreference(value: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Preference is lost on reload. Not worth surfacing — the app still works.
  }
}

function prefersDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches
  } catch {
    return false
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'daylight' || preference === 'slate') return preference
  return prefersDark() ? 'slate' : 'daylight'
}

/**
 * Stamps the root element and rewrites <meta name="theme-color">.
 *
 * The meta value is read back out of the cascade rather than kept in a table here, so a change
 * to --th-theme-color in a theme file is the only edit needed — the status bar cannot fall out
 * of sync with the page behind it.
 */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme === 'slate' ? 'dark' : 'light'

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) return
  const fromCss = getComputedStyle(root).getPropertyValue('--th-theme-color').trim()
  meta.content = fromCss || FALLBACK_THEME_COLOR[theme]
}

// Run before React mounts. An effect would paint one frame of Daylight into a dark room first,
// which on a phone at 7am is the difference between "themed app" and "flashbang".
if (typeof document !== 'undefined') {
  applyTheme(resolveTheme(readStoredPreference()))
}

interface ThemeContextValue {
  /** What the user chose, including `system`. This is what the Settings screen renders. */
  theme: ThemePreference
  /** What is actually on screen. This is what a component reads. */
  resolvedTheme: ResolvedTheme
  setTheme: (next: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredPreference)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(theme),
  )

  useEffect(() => {
    const next = resolveTheme(theme)
    setResolvedTheme(next)
    applyTheme(next)
  }, [theme])

  // Only meaningful while the preference is `system`; an explicit choice outranks the OS.
  useEffect(() => {
    if (theme !== 'system') return
    let mql: MediaQueryList
    try {
      mql = window.matchMedia(DARK_QUERY)
    } catch {
      return
    }
    const onChange = () => {
      const next = resolveTheme('system')
      setResolvedTheme(next)
      applyTheme(next)
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next)
    writeStoredPreference(next)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
