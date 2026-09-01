import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The "not built yet" state.
 *
 * It exists so the nine routes can be navigated, and its only job is to be honest. It shows no
 * numbers, no rows and no sample athletes: a fake roster in a shell build is how a screenshot
 * ends up in a status update as evidence of a screen that does not exist. It names the
 * milestone that builds it, and it echoes the route params it actually received so the routing
 * can be verified on a phone with no data behind it.
 */

export interface PlaceholderProps {
  /** The screen's real title, already translated by the caller. */
  title: string
  /** The milestone that replaces this file — "M2", "M3", "M6". Printed verbatim. */
  milestone: string
  /** One line on what the finished screen will do. Already translated. */
  description?: string
  /** Route params, as `[label, value]`. Rendered so a wrong `:athleteId` is visible. */
  params?: ReadonlyArray<readonly [label: string, value: string | undefined]>
}

const card: CSSProperties = {
  background: 'var(--th-surface)',
  border: '1px solid var(--th-line)',
  borderRadius: 'var(--th-r-lg)',
  padding: 'var(--th-pad)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const badge: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '5px 10px',
  borderRadius: 'var(--th-r-pill)',
  background: 'var(--th-surface-3)',
  color: 'var(--th-muted)',
  fontSize: 'var(--th-text-xs)',
  fontWeight: 600,
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
}

export function Placeholder({ title, milestone, description, params }: PlaceholderProps) {
  const { t } = useTranslation()

  return (
    <>
      <h1 className="display" style={{ fontSize: 'var(--th-text-2xl)', margin: 0 }}>
        {title}
      </h1>

      {/* The smoke suite fails any route still rendering this, so an unbuilt screen cannot
          quietly ship behind a green typecheck. */}
      <div style={card} data-testid="placeholder">
        <span style={badge}>{t('placeholder.badge')}</span>
        {description ? (
          <p style={{ margin: 0, color: 'var(--th-ink)', lineHeight: 1.5 }}>{description}</p>
        ) : null}
        <p style={{ margin: 0, color: 'var(--th-muted)', lineHeight: 1.5 }}>
          {t('placeholder.body', { milestone })}
        </p>
        <p style={{ margin: 0, color: 'var(--th-faint)', fontSize: 'var(--th-text-sm)' }}>
          {t('placeholder.noData')}
        </p>
      </div>

      {params && params.length > 0 ? (
        <div style={card}>
          <span style={badge}>{t('placeholder.routeParams')}</span>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px' }}>
            {params.map(([label, value]) => (
              <div key={label} style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--th-muted)', fontSize: 'var(--th-text-sm)' }}>{label}</dt>
                <dd
                  className="num"
                  style={{
                    margin: 0,
                    color: 'var(--th-ink)',
                    fontSize: 'var(--th-text-sm)',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {value ?? '—'}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </>
  )
}
