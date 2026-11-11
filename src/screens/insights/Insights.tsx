import { useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import type { ProgressData } from '@/data/repo/types'
import type { AnalyticsData } from '@/domain/analytics'
import { shiftLocalDate } from '@/domain/calendar'
import { formatDate, formatWeight } from '@/domain/format'
import { personalRecords, weeklyFrequency, weekStreak, type PersonalRecord, type WeekCount } from '@/domain/insights'
import type { Block, Exercise, LocalDate, Membership, Uuid } from '@/domain/types'
import { currentLocale } from '@/i18n'
import { Card, EmptyState, Icon, type IconName } from '@/ui'
import { exerciseName } from '@/screens/progress/ProgressSection'

/**
 * What the Πρόοδος and Ρεκόρ tabs lead with: four tiles, a frequency chart, the records list.
 *
 * Everything here reads the same `ProgressData` the existing charts read, so the staff sheet,
 * the athlete's own panel and a shared link draw identical numbers from identical rows.
 */

type Members = readonly Pick<Membership, 'id' | 'displayName'>[]

export function analyticsOf(progress: ProgressData | undefined, memberships: Members): AnalyticsData | null {
  if (!progress) return null
  return {
    sessions: progress.sessions,
    blocks: progress.blocks as Block[],
    sets: progress.sets,
    exercises: progress.exercises,
    memberships,
  }
}

const label: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
}

const muted: CSSProperties = { margin: 0, fontSize: 'var(--th-text-sm)', color: 'var(--th-muted)', lineHeight: 1.45 }

// ---------------------------------------------------------------------------

interface Tile {
  icon: IconName
  value: string | number
  label: string
}

export function StatTiles({ tiles }: { tiles: readonly Tile[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--th-gap)' }}>
      {tiles.map((tile) => (
        <Card key={tile.label}>
          <div className="th-stat">
            <span style={{ color: 'var(--th-brand)', display: 'flex' }}>
              <Icon name={tile.icon} size={18} strokeWidth={2} />
            </span>
            <span className="th-stat__value num">{tile.value}</span>
            <span className="th-stat__label">{tile.label}</span>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------

const W = 320
const H = 110

/** Sessions per week. Bars, because "how often" is a count, not a trend line. */
export function FrequencyBars({ weeks }: { weeks: readonly WeekCount[] }) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const max = Math.max(...weeks.map((w) => w.sessions), 1)
  const slot = W / Math.max(weeks.length, 1)
  const barWidth = Math.max(slot * 0.58, 3)
  const summary = weeks
    .map((w) => t('insights.weekSessions', { date: formatDate(w.weekStart, locale), count: w.sessions }))
    .join(', ')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="frequency-bars">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: H, display: 'block' }}
        role="img"
        aria-label={`${t('insights.frequency')} — ${summary}`}
      >
        {Array.from({ length: max }, (_, i) => {
          const y = H - ((i + 1) / max) * (H - 10)
          return (
            <line key={i} x1={0} x2={W} y1={y} y2={y} stroke="var(--th-line-soft)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )
        })}
        {weeks.map((week, index) => {
          const height = week.sessions === 0 ? 2 : (week.sessions / max) * (H - 10)
          const current = index === weeks.length - 1
          return (
            <rect
              key={week.weekStart}
              x={index * slot + (slot - barWidth) / 2}
              y={H - height}
              width={barWidth}
              height={height}
              rx={4}
              fill={week.sessions === 0 ? 'var(--th-line)' : 'var(--th-brand)'}
              fillOpacity={current || week.sessions === 0 ? 1 : 0.68}
            />
          )
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--th-text-xs)', color: 'var(--th-faint)' }}>
        <span className="num">{weeks[0] ? formatDate(weeks[0].weekStart, locale) : ''}</span>
        <span className="num">{weeks.length ? formatDate(weeks[weeks.length - 1].weekStart, locale) : ''}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export interface InsightsProps {
  athleteId: Uuid
  progress: ProgressData | undefined
  memberships: Members
  today: LocalDate
}

export function useInsights({ athleteId, progress, memberships, today }: InsightsProps) {
  const data = useMemo(() => analyticsOf(progress, memberships), [progress, memberships])
  return useMemo(() => {
    const sessions = progress?.sessions ?? []
    const weeks = weeklyFrequency(sessions, athleteId, today, 12)
    const trainedWeeks = weeks.filter((w) => w.sessions > 0)
    const firstTrained = weeks.findIndex((w) => w.sessions > 0)
    const span = firstTrained < 0 ? 0 : weeks.length - firstTrained
    const total = trainedWeeks.reduce((sum, w) => sum + w.sessions, 0)
    const records = data ? personalRecords(data, athleteId) : []
    const since = shiftLocalDate(today, -30)
    return {
      weeks,
      streak: weekStreak(sessions, athleteId, today),
      thisWeek: weeks[weeks.length - 1]?.sessions ?? 0,
      perWeek: span ? total / span : 0,
      records,
      recentRecords: records.filter((r) => r.date >= since).length,
    }
  }, [data, progress, athleteId, today])
}

/** The top of a Πρόοδος tab: four tiles and the frequency chart. */
export function InsightsOverview(props: InsightsProps) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const insight = useInsights(props)
  const perWeek = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'el-GR', { maximumFractionDigits: 1 }).format(insight.perWeek)

  return (
    <>
      <StatTiles
        tiles={[
          { icon: 'flame', value: insight.streak, label: t('insights.streak') },
          { icon: 'calendar', value: insight.thisWeek, label: t('insights.thisWeek') },
          { icon: 'chart', value: perWeek, label: t('insights.perWeek') },
          { icon: 'trophy', value: insight.recentRecords, label: t('insights.newRecords') },
        ]}
      />
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 style={label}>{t('insights.frequency')}</h3>
          <FrequencyBars weeks={insight.weeks} />
          <p style={{ ...muted, fontSize: 'var(--th-text-xs)' }}>{t('insights.frequencyHint')}</p>
        </div>
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------

const row: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '36px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 12,
  padding: '12px 0',
  borderTop: '1px solid var(--th-line-soft)',
}

/**
 * Each record as "92 kg · 80 × 5 · 8 Οκτ · Νίκος": the estimate, the set it came from, the day
 * and the coach — an estimate on its own is a number nobody can be asked about.
 */
export function RecordsList({
  records,
  exercises,
  memberships,
  limit,
}: {
  records: readonly PersonalRecord[]
  exercises: readonly Exercise[]
  memberships: Members
  limit?: number
}) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises])
  const names = useMemo(() => new Map(memberships.map((m) => [m.id, m.displayName])), [memberships])
  const shown = limit ? records.slice(0, limit) : records

  if (shown.length === 0) return <EmptyState icon="trophy" title={t('insights.recordsEmpty')} description={t('progress.noExercisesHint')} />

  return (
    <div data-testid="records" style={{ display: 'flex', flexDirection: 'column' }}>
      {shown.map((record, index) => {
        const exercise = byId.get(record.exerciseId)
        const author = record.authorId ? names.get(record.authorId) : undefined
        const value = record.weighted ? formatWeight(record.value, locale, { unit: true }) : t('counts.rep', { count: record.value })
        const detail = [
          record.weighted ? t('insights.recordSet', { kg: formatWeight(record.topKg, locale), reps: record.topReps }) : null,
          formatDate(record.date, locale),
          author,
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <div key={record.exerciseId} style={{ ...row, borderTop: index === 0 ? 'none' : row.borderTop }}>
            <span
              aria-hidden="true"
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--th-brand-soft)',
                color: 'var(--th-brand)',
              }}
            >
              <Icon name="trophy" size={18} strokeWidth={2} />
            </span>
            <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <strong style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {exercise ? exerciseName(exercise, locale) : '—'}
              </strong>
              <span className="num" style={{ fontSize: 'var(--th-text-xs)', color: 'var(--th-muted)' }}>
                {detail}
              </span>
            </span>
            <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="num display" style={{ fontSize: 'var(--th-text-lg)' }}>
                {value}
              </span>
              <span style={{ fontSize: 'var(--th-text-xs)', color: 'var(--th-faint)' }}>
                {record.weighted ? t('progress.est1rm') : t('progress.maxReps')}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** The Ρεκόρ tab's body. */
export function RecordsCard(props: InsightsProps & { limit?: number; title?: string }) {
  const { t } = useTranslation()
  const insight = useInsights(props)
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3 style={label}>{props.title ?? t('insights.recordsTitle')}</h3>
        {props.limit ? null : <p style={muted}>{t('insights.recordsHint')}</p>}
        <RecordsList
          records={insight.records}
          exercises={props.progress?.exercises ?? []}
          memberships={props.memberships}
          limit={props.limit}
        />
      </div>
    </Card>
  )
}
