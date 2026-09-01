import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { formatDate, formatVolume } from '@/domain/format'
import { currentLocale } from '@/i18n'
import { CATEGORY_TOKEN } from '@/theme/tokens.contract'
import type { BodyPartSlice } from '@/domain/analytics'
import type { LocalDate } from '@/domain/types'
import { EmptyState } from '@/ui'

/**
 * Three hand-rolled SVG charts. No chart library — see the "do not add dependencies" rule, and
 * the fact that everything these need is one polyline and a handful of rectangles.
 *
 * Two rules they all follow:
 *
 *  - **Colour comes from tokens only**, so both themes are handled by not handling them.
 *  - **No `<text>` inside the SVG.** The plots are drawn in a 320×140 user space and stretched
 *    to the container with `preserveAspectRatio="none"`, which would stretch glyphs with them.
 *    Every label is HTML beside the plot, which also makes it selectable and translatable.
 *
 * Each chart owns its empty state. An athlete with one session is the normal case in the first
 * week of a pilot, and a single-point line chart is a dot that looks like a rendering failure.
 */

const W = 320
const H = 140

const plotStyle: CSSProperties = { width: '100%', height: H, display: 'block' }

const axisRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 'var(--th-text-xs)',
  color: 'var(--th-faint)',
}

const captionStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  lineHeight: 1.45,
}

export interface SeriesPoint {
  date: LocalDate
  value: number
}

export interface TrendChartProps {
  points: readonly SeriesPoint[]
  /** Names the series for assistive tech — "Εκτ. 1RM · Πιέσεις Στήθους". */
  ariaLabel: string
  /** Rendered under the plot. The caller puts the date and the author of the latest point here. */
  caption?: ReactNode
  formatValue: (value: number) => string
}

/** Maps a series onto the plot box, with a little headroom so the line never touches the edge. */
function scale(values: readonly number[]): (value: number) => number {
  const min = Math.min(...values)
  const max = Math.max(...values)
  // A flat series (three sessions at the same load, which is what a deload looks like) would
  // divide by zero and vanish; it is drawn as a level line through the middle instead.
  if (max === min) return () => H / 2
  const top = 14
  const bottom = H - 14
  return (value) => bottom - ((value - min) / (max - min)) * (bottom - top)
}

function xAt(index: number, count: number): number {
  if (count <= 1) return W / 2
  return (index / (count - 1)) * W
}

/**
 * Estimated 1RM (or top reps for an unloaded movement) over time: a faint grid, an area fill
 * and an emphasised endpoint, because "where am I now" is the only point anyone reads first.
 */
export function TrendChart({ points, ariaLabel, caption, formatValue }: TrendChartProps) {
  const { t } = useTranslation()
  const locale = currentLocale()

  if (points.length === 0) {
    return <EmptyState icon="sparkle" title={t('progress.needMoreData')} />
  }
  if (points.length === 1) {
    return (
      <EmptyState
        icon="sparkle"
        title={t('progress.oneDataPoint')}
        description={`${formatValue(points[0].value)} · ${formatDate(points[0].date, locale)}`}
      />
    )
  }

  const y = scale(points.map((p) => p.value))
  const coords = points.map((point, index) => ({ x: xAt(index, points.length), y: y(point.value) }))
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const last = coords[coords.length - 1]
  const values = points.map((p) => p.value)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="trend-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={plotStyle}
        role="img"
        aria-label={ariaLabel}
      >
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1={0}
            x2={W}
            y1={H * fraction}
            y2={H * fraction}
            stroke="var(--th-line-soft)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill="var(--th-accent)" fillOpacity={0.14} />
        <path
          d={line}
          fill="none"
          stroke="var(--th-accent)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={last.x} cy={last.y} r={9} fill="var(--th-accent)" fillOpacity={0.2} />
        <circle cx={last.x} cy={last.y} r={4} fill="var(--th-accent)" />
      </svg>

      <div style={axisRow}>
        <span className="num">{formatDate(points[0].date, locale)}</span>
        <span className="num">
          {formatValue(Math.min(...values))} – {formatValue(Math.max(...values))}
        </span>
        <span className="num">{formatDate(points[points.length - 1].date, locale)}</span>
      </div>

      {caption ? <p style={captionStyle}>{caption}</p> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

export interface ShareBarProps {
  slices: readonly BodyPartSlice[]
}

const legendRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-ink)',
}

const legendDot: CSSProperties = { width: 10, height: 10, borderRadius: '50%', flex: '0 0 auto' }

/**
 * Sets per body part.
 *
 * Labelled for what it plots. The prototype called the same chart "volume distribution" while
 * summing SET COUNTS, so a coach comparing it against the session's volume total found two
 * numbers that could not both be right — and the mislabelled one is the one that looks like
 * kilos. `bodyPartShare` carries volume too; this bar deliberately shows sets, because a
 * cardio or mobility slice has no kilos and would silently disappear from a volume share.
 */
export function ShareBar({ slices }: ShareBarProps) {
  const { t } = useTranslation()

  const total = slices.reduce((sum, slice) => sum + slice.sets, 0)
  if (total === 0) {
    return <EmptyState icon="sparkle" title={t('progress.needMoreData')} />
  }

  const summary = slices
    .map((slice) => `${t(`categories.${slice.category}`)}: ${t('counts.set', { count: slice.sets })}`)
    .join(', ')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="share-bar">
      <div
        style={{ display: 'flex', height: 14, borderRadius: 'var(--th-r-pill)', overflow: 'hidden' }}
        role="img"
        aria-label={`${t('progress.setShare')} — ${summary}`}
      >
        {slices.map((slice) => (
          <span
            key={slice.category}
            style={{
              width: `${(slice.sets / total) * 100}%`,
              background: `var(${CATEGORY_TOKEN[slice.category]})`,
            }}
          />
        ))}
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {slices.map((slice) => (
          <li key={slice.category} style={legendRow}>
            <span
              aria-hidden="true"
              style={{ ...legendDot, background: `var(${CATEGORY_TOKEN[slice.category]})` }}
            />
            <span style={{ flex: '1 1 auto' }}>{t(`categories.${slice.category}`)}</span>
            <span className="num" style={{ color: 'var(--th-muted)' }}>
              {t('counts.set', { count: slice.sets })}
            </span>
            <span className="num" style={{ color: 'var(--th-faint)', minWidth: 44, textAlign: 'right' }}>
              {Math.round((slice.sets / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>

      <p style={{ ...captionStyle, color: 'var(--th-faint)' }}>{t('progress.setShareHint')}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------

export interface WeekBar {
  weekStart: LocalDate
  volume: number
}

export interface VolumeBarsProps {
  weeks: readonly WeekBar[]
}

/** Volume per week — the one number a coach quotes to an athlete who asks if they are working. */
export function VolumeBars({ weeks }: VolumeBarsProps) {
  const { t } = useTranslation()
  const locale = currentLocale()

  if (weeks.length < 2) {
    return (
      <EmptyState
        icon="sparkle"
        title={weeks.length === 0 ? t('progress.needMoreData') : t('progress.oneDataPoint')}
      />
    )
  }

  const max = Math.max(...weeks.map((week) => week.volume), 1)
  const slot = W / weeks.length
  const barWidth = Math.max(slot * 0.62, 3)
  const summary = weeks
    .map((week) => `${t('progress.weekOf', { date: formatDate(week.weekStart, locale) })}: ${formatVolume(week.volume, locale)}`)
    .join(', ')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="volume-bars">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={plotStyle}
        role="img"
        aria-label={`${t('progress.weeklyVolume')} — ${summary}`}
      >
        <line
          x1={0}
          x2={W}
          y1={H - 1}
          y2={H - 1}
          stroke="var(--th-line-soft)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {weeks.map((week, index) => {
          // A logged-but-empty week still gets a visible stub, so a gap in the block reads as
          // "nothing was lifted" rather than as a chart that failed to draw.
          const height = Math.max((week.volume / max) * (H - 16), week.volume > 0 ? 3 : 1)
          return (
            <rect
              key={week.weekStart}
              x={index * slot + (slot - barWidth) / 2}
              y={H - height}
              width={barWidth}
              height={height}
              rx={3}
              fill="var(--th-accent)"
              fillOpacity={index === weeks.length - 1 ? 1 : 0.45}
            />
          )
        })}
      </svg>

      <div style={axisRow}>
        <span className="num">{formatDate(weeks[0].weekStart, locale)}</span>
        <span className="num">{`${t('log.totalVolume')} ${formatVolume(max, locale)}`}</span>
        <span className="num">{formatDate(weeks[weeks.length - 1].weekStart, locale)}</span>
      </div>
    </div>
  )
}
