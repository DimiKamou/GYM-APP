import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { ThemeProvider, useTheme, type ThemePreference } from '@/theme/ThemeProvider'
import '@/styles/tokens.css'

/**
 * Minimal entry point: mounts the theme layer and nothing else.
 *
 * The router, i18n, query client and auth provider are composed in here in M1's app-shell
 * slice; until then this exists so the app builds and so the two themes can be checked on a
 * real device rather than in a screenshot.
 */

const THEMES: ThemePreference[] = ['system', 'daylight', 'slate']

function ThemeCheck() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const categories = ['upper', 'lower', 'core', 'cardio', 'mobility'] as const

  return (
    <main
      style={{
        minHeight: '100dvh',
        background: 'var(--th-bg)',
        backgroundImage: 'var(--th-bg-image)',
        color: 'var(--th-ink)',
        fontFamily: 'var(--th-font-ui)',
        padding: '32px 20px calc(32px + env(safe-area-inset-bottom))',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        maxWidth: 480,
        margin: '0 auto',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--th-accent)',
          }}
        >
          TrainHub
        </span>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--th-font-display)',
            fontWeight: 'var(--th-display-weight)' as never,
            letterSpacing: 'var(--th-display-tracking)' as never,
            fontSize: 32,
            lineHeight: 1.05,
          }}
        >
          Το κοινό δελτίο
        </h1>
        <p style={{ margin: 0, color: 'var(--th-muted)', lineHeight: 1.5 }}>
          Κάθε σετ, με το όνομα του προπονητή που το έγραψε.
        </p>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--th-faint)' }}>
          Θέμα · {resolvedTheme}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {THEMES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTheme(option)}
              aria-pressed={theme === option}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 'var(--th-r)',
                border: '1px solid var(--th-line)',
                background: theme === option ? 'var(--th-accent)' : 'var(--th-surface)',
                color: theme === option ? 'var(--th-accent-ink)' : 'var(--th-ink)',
                fontFamily: 'inherit',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {option}
            </button>
          ))}
        </div>
      </section>

      {/* The five body-part colours are the tokens most likely to regress, so they are the ones on screen. */}
      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {categories.map((c) => (
          <span
            key={c}
            style={{
              padding: '7px 12px',
              borderRadius: 999,
              fontSize: 12.5,
              fontWeight: 600,
              background: 'var(--th-surface-2)',
              color: `var(--th-cat-${c})`,
            }}
          >
            {c}
          </span>
        ))}
      </section>

      <section
        style={{
          background: 'var(--th-surface)',
          border: '1px solid var(--th-line)',
          borderRadius: 'var(--th-r-lg)',
          padding: 18,
          boxShadow: 'var(--th-shadow)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--th-muted)' }}>
          Τελευταία φορά
        </span>
        {/* A coaching number is never rendered without its date and author — the coach loads a bar with it. */}
        <span className="num" style={{ fontSize: 20, fontWeight: 600 }}>
          80×8 <span style={{ color: 'var(--th-muted)', fontSize: 14, fontWeight: 500 }}>· 12 Αυγ · Μαρία</span>
        </span>
      </section>
    </main>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root is missing from index.html')

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <ThemeCheck />
    </ThemeProvider>
  </StrictMode>,
)
