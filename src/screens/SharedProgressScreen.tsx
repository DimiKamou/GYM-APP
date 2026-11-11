import { useMemo, type CSSProperties } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useSharedProgress } from '@/data/hooks'
import { sessionSets, sessionVolume } from '@/domain/analytics'
import { formatDate, formatVolume } from '@/domain/format'
import { currentLocale } from '@/i18n'
import { Card, EmptyState, Screen, Spinner } from '@/ui'
import { MonthCalendar, WorkoutBox } from '@/screens/history/HistoryViews'
import { buildWorkouts, useRecapContext } from '@/screens/history/workouts'
import { ProgressView } from '@/screens/progress/ProgressSection'

/**
 * The page a share link opens: one athlete's progress for the period the coach chose, with no
 * sign-in. Everything comes from `shared_progress(token)`, the one function anon may call; a
 * revoked link returns nothing and this page says so.
 *
 * The staff's free text is not drawn here, even where the function returns it: the link goes
 * to an athlete or a parent, and those remarks were written for the next coach.
 */

const muted: CSSProperties = { margin: 0, fontSize: 'var(--th-text-sm)', color: 'var(--th-muted)', lineHeight: 1.45 }

const statsGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--th-gap)' }

export function SharedProgressScreen() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const { token } = useParams<'token'>()
  const shared = useSharedProgress(token ?? null)
  const data = shared.data ?? null

  const progress = useMemo(
    () =>
      data
        ? {
            sessions: data.sessions,
            blocks: data.blocks,
            sets: data.sets,
            exercises: data.exercises,
            muscleGroups: data.muscleGroups.map((g, i) => ({
              ...g,
              gymId: null,
              slug: g.id,
              region: 'upper' as const,
              position: i,
              createdAt: '',
              updatedAt: '',
              deletedAt: null,
              createdBy: null,
            })),
            exerciseMuscles: data.exerciseMuscles.map((m) => ({
              ...m,
              gymId: null,
              createdAt: '',
              updatedAt: '',
              deletedAt: null,
              createdBy: null,
            })),
          }
        : undefined,
    [data],
  )
  const ctx = useRecapContext(progress)
  const workouts = useMemo(() => (progress ? buildWorkouts(progress) : []), [progress])
  const names = useMemo(() => new Map((data?.members ?? []).map((m) => [m.id, m.displayName])), [data])

  if (shared.isPending) {
    return (
      <Screen label={t('share.pageTitle')}>
        <Spinner label={t('common.loading')} />
      </Screen>
    )
  }

  if (!data) {
    return (
      <Screen label={t('share.pageTitle')}>
        <EmptyState icon="alert" title={t('share.gone')} description={t('share.goneHint')} />
      </Screen>
    )
  }

  const allSets = workouts.flatMap((w) => w.sets)
  const today = data.period?.toDate ?? new Date().toISOString().slice(0, 10)
  const periodText = data.period?.fromDate
    ? `${formatDate(data.period.fromDate, locale)} – ${formatDate(data.period.toDate ?? today, locale)}`
    : null

  return (
    <Screen
      label={t('share.pageTitle')}
      header={
        <div>
          <p style={{ ...muted, fontSize: 'var(--th-text-xs)', letterSpacing: 'var(--th-label-tracking)', textTransform: 'uppercase' }}>
            {data.gymName}
          </p>
          <h1 className="display" style={{ margin: '4px 0 0', fontSize: 'var(--th-text-2xl)' }}>
            {data.athleteName}
          </h1>
          {periodText ? <p style={muted}>{periodText}</p> : null}
        </div>
      }
    >
      <div style={statsGrid}>
        <Card>
          <span className="num display" style={{ fontSize: 'var(--th-text-lg)', display: 'block' }}>{workouts.length}</span>
          <span style={muted}>{t('athlete.statSessions')}</span>
        </Card>
        <Card>
          <span className="num display" style={{ fontSize: 'var(--th-text-lg)', display: 'block' }}>{sessionSets(allSets)}</span>
          <span style={muted}>{t('log.totalSets')}</span>
        </Card>
        <Card>
          <span className="num display" style={{ fontSize: 'var(--th-text-lg)', display: 'block' }}>{formatVolume(sessionVolume(allSets), locale)}</span>
          <span style={muted}>{t('log.totalVolume')}</span>
        </Card>
      </div>

      {workouts.length > 0 ? (
        <Card>
          <MonthCalendar workouts={workouts} ctx={ctx} names={names} today={today} showNotes={false} />
        </Card>
      ) : null}

      {progress && data.sessions[0] ? (
        <ProgressView athleteId={data.sessions[0].athleteId} progress={progress} pending={false} memberships={data.members} />
      ) : null}

      {workouts.map((w) => (
        <Card key={w.session.id}>
          <WorkoutBox workout={w} ctx={ctx} names={names} showNotes={false} />
        </Card>
      ))}
    </Screen>
  )
}
