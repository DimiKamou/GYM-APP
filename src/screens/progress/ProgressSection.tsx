import { useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { addDays, useProgressData, useTeam } from '@/data/hooks'
import type { ProgressData } from '@/data/repo/types'
import {
  athleteExercises,
  bodyPartShare,
  exerciseTrend,
  sessionAuthorId,
  sessionVolume,
  type AnalyticsData,
} from '@/domain/analytics'
import { formatDate, formatWeight, type Locale } from '@/domain/format'
import { currentLocale } from '@/i18n'
import type { Block, Exercise, LocalDate, Uuid, WorkoutSet } from '@/domain/types'
import { Card, Chip, EmptyState, Spinner } from '@/ui'
import { ShareBar, TrendChart, VolumeBars, type SeriesPoint, type WeekBar } from '@/screens/progress/Charts'

/**
 * Progress, below the fold.
 *
 * Everything numeric here comes out of `@/domain/analytics` — this file picks an exercise,
 * buckets sessions into weeks and hands the results to three dumb SVGs. A second copy of the
 * volume or 1RM maths would drift from the Log screen's totals within a week, and the coach
 * would have two numbers for one lift and no way to tell which is real.
 */

export interface ProgressSectionProps {
  athleteId: Uuid
}

const heading: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
}

const chipRow: CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' }

const section: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }

/** How many weeks of bars fit a phone before they turn into a barcode. */
const WEEKS_SHOWN = 12
/** More exercise chips than this and the picker is a second screen, not a row. */
const EXERCISES_SHOWN = 6

export function ProgressSection({ athleteId }: ProgressSectionProps) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const progress = useProgressData(athleteId)
  const team = useTeam()
  const [chosen, setChosen] = useState<Uuid | null>(null)

  const data = useMemo<AnalyticsData | null>(() => {
    if (!progress.data) return null
    return {
      sessions: progress.data.sessions,
      // `ProgressData.blocks` is exactly the subset analytics reads (id, session, exercise,
      // position, deletedAt); widening it would mean inventing audit columns the repository
      // deliberately did not fetch.
      blocks: progress.data.blocks as Block[],
      sets: progress.data.sets,
      exercises: progress.data.exercises,
      memberships: team.data ?? [],
    }
  }, [progress.data, team.data])

  const usage = useMemo(
    () => (data ? athleteExercises(data, athleteId).slice(0, EXERCISES_SHOWN) : []),
    [data, athleteId],
  )

  const exerciseById = useMemo(() => {
    const map = new Map<Uuid, Exercise>()
    for (const exercise of progress.data?.exercises ?? []) map.set(exercise.id, exercise)
    return map
  }, [progress.data])

  const selected = chosen && usage.some((u) => u.exerciseId === chosen) ? chosen : (usage[0]?.exerciseId ?? null)

  const trend = useMemo(
    () => (data && selected ? exerciseTrend(data, athleteId, selected) : null),
    [data, athleteId, selected],
  )

  const share = useMemo(() => (data ? bodyPartShare(data, athleteId) : []), [data, athleteId])
  const weeks = useMemo(() => (progress.data ? weeklyVolume(progress.data) : []), [progress.data])

  if (progress.isPending) return <Spinner label={t('common.loading')} />

  if (!data || usage.length === 0) {
    return (
      <section style={section} aria-label={t('progress.title')} data-testid="progress">
        <h2 style={heading}>{t('progress.title')}</h2>
        <EmptyState
          icon="sparkle"
          title={t('progress.noExercises')}
          description={t('progress.noExercisesHint')}
        />
      </section>
    )
  }

  const selectedExercise = selected ? exerciseById.get(selected) : undefined
  const selectedName = selectedExercise ? exerciseName(selectedExercise, locale) : ''
  // An exercise nobody ever loaded (pull-ups, the plank) has no 1RM. Plotting one anyway would
  // draw a flat zero line under a label that says kilos.
  const weighted = trend?.weighted ?? false
  const seriesLabel = weighted ? t('progress.est1rm') : t('progress.maxReps')

  const points: SeriesPoint[] = (trend?.points ?? []).map((point) => ({
    date: point.date,
    value: weighted ? point.oneRm : point.topReps,
  }))

  const formatValue = (value: number) =>
    weighted ? formatWeight(value, locale, { unit: true }) : t('counts.rep', { count: value })

  /**
   * The endpoint, written out with the date and the coach it belongs to.
   *
   * An estimate is still a number a coach programmes from, so it never appears alone: "92 kg"
   * on its own invites somebody to load 92 kg that nobody can be asked about.
   */
  const latestCaption = (): string | null => {
    const last = trend?.points[trend.points.length - 1]
    if (!last || points.length < 2) return null
    const session = progress.data?.sessions.find((s) => s.id === last.sessionId)
    const author = session
      ? ((team.data ?? []).find((member) => member.id === sessionAuthorId(session))?.displayName ?? null)
      : null
    return [
      `${t('progress.latest')}: ${formatValue(weighted ? last.oneRm : last.topReps)}`,
      formatDate(last.date, locale),
      author,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' · ')
  }

  return (
    <section style={section} aria-label={t('progress.title')} data-testid="progress">
      <h2 style={heading}>{t('progress.title')}</h2>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={chipRow} role="group" aria-label={t('picker.title')}>
            {usage.map((entry) => {
              const exercise = exerciseById.get(entry.exerciseId)
              if (!exercise) return null
              return (
                <Chip
                  key={entry.exerciseId}
                  selected={entry.exerciseId === selected}
                  onClick={() => setChosen(entry.exerciseId)}
                >
                  {exerciseName(exercise, locale)}
                </Chip>
              )
            })}
          </div>

          <h3 style={heading}>{`${seriesLabel} · ${selectedName}`}</h3>
          <TrendChart
            points={points}
            ariaLabel={`${seriesLabel} · ${selectedName}`}
            formatValue={formatValue}
            caption={latestCaption()}
          />
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={heading}>{t('progress.setShare')}</h3>
          <ShareBar slices={share} />
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={heading}>{t('progress.weeklyVolume')}</h3>
          <VolumeBars weeks={weeks} />
        </div>
      </Card>
    </section>
  )
}

/** Greek first, English as the courtesy — the same order the catalogue is written in. */
export function exerciseName(exercise: Exercise, locale: Locale): string {
  const primary = locale === 'en' ? exercise.nameEn : exercise.nameEl
  return primary ?? exercise.nameEn ?? exercise.nameEl ?? ''
}

/**
 * Volume per calendar week, Monday-based, with the idle weeks kept.
 *
 * Dropping an empty week would compress a two-week holiday into a neighbouring bar and make
 * the block look denser than it was. `addDays` is the app's one piece of calendar arithmetic
 * (a `LocalDate` is a date, not an instant, and parsing it as one shifts it across midnight).
 */
function weeklyVolume(progress: ProgressData): WeekBar[] {
  const sessionOfBlock = new Map<Uuid, Uuid>()
  for (const block of progress.blocks) {
    if (block.deletedAt === null) sessionOfBlock.set(block.id, block.sessionId)
  }

  const setsBySession = new Map<Uuid, WorkoutSet[]>()
  for (const set of progress.sets) {
    const sessionId = sessionOfBlock.get(set.blockId)
    if (!sessionId) continue
    const list = setsBySession.get(sessionId)
    if (list) list.push(set)
    else setsBySession.set(sessionId, [set])
  }

  const byWeek = new Map<LocalDate, number>()
  for (const session of progress.sessions) {
    if (session.deletedAt !== null) continue
    const week = weekStart(session.localDate)
    const volume = sessionVolume(setsBySession.get(session.id) ?? [])
    byWeek.set(week, (byWeek.get(week) ?? 0) + volume)
  }
  if (byWeek.size === 0) return []

  const weeks = Array.from(byWeek.keys()).sort()
  const bars: WeekBar[] = []
  for (let week = weeks[0]; week <= weeks[weeks.length - 1]; week = addDays(week, 7)) {
    bars.push({ weekStart: week, volume: byWeek.get(week) ?? 0 })
  }
  return bars.slice(-WEEKS_SHOWN)
}

/** The Monday of a calendar date's week. */
function weekStart(date: LocalDate): LocalDate {
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  // getUTCDay() is 0 on Sunday; the gym's week starts on Monday, as the calendar screen's does.
  return addDays(date, -((at.getUTCDay() + 6) % 7))
}
