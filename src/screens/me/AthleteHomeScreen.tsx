import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import { useAthletePortal } from '@/data/hooks'
import { ATHLETE_ACCOUNTS_MISSING } from '@/data/repo/types'
import { sessionSets, sessionVolume } from '@/domain/analytics'
import { formatVolume } from '@/domain/format'
import { currentLocale } from '@/i18n'
import { Button, Card, EmptyState, Icon, Screen, Segmented, Spinner, Tabs, useTabParam } from '@/ui'
import { todayIn } from '@/screens/calendar/WeekStrip'
import { MonthCalendar } from '@/screens/history/HistoryViews'
import { buildWorkouts, useRecapContext } from '@/screens/history/workouts'
import { InsightsOverview, RecordsCard } from '@/screens/insights/Insights'
import { HistoryList } from '@/screens/athlete/HistoryList'
import { ProgressView } from '@/screens/progress/ProgressSection'
import { portalProgress } from '@/screens/me/portal'

/**
 * The athlete's panel: their own sheet, read-only.
 *
 * Four tabs, from the athlete's side of the clipboard: Αρχική (who is training them and on what,
 * the streak, the latest records), Ιστορικό, Πρόοδος and Ρεκόρ. Every
 * session row carries its date and the coach who wrote it, exactly as the staff see it — "who
 * wrote this line" is the product, and an athlete asking "who put 80 on that?" deserves the
 * same answer the covering coach gets.
 *
 * What is NOT here is the staff's own writing — notes, warnings, set remarks. The server never
 * sends it (see 015); nothing on this screen has to remember to hide it.
 */

const PORTAL_TABS = ['home', 'history', 'progress', 'records'] as const

const headerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
}

const eyebrow: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
}

const titleStyle: CSSProperties = { fontSize: 'var(--th-text-2xl)', margin: '4px 0 0' }

const iconButton: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 44,
  height: 44,
  borderRadius: 'var(--th-r-sm)',
  background: 'var(--th-surface)',
  border: '1px solid var(--th-line)',
  color: 'var(--th-ink)',
  flex: '0 0 auto',
}

const statsGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 'var(--th-gap)',
}

const statValue: CSSProperties = { fontSize: 'var(--th-text-lg)', color: 'var(--th-ink)', display: 'block' }

const statLabel: CSSProperties = {
  display: 'block',
  marginTop: 4,
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
}

const sectionHeading: CSSProperties = { ...eyebrow }

const section: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--th-gap)' }

const planText: CSSProperties = { margin: 0, fontSize: 'var(--th-text-sm)', lineHeight: 1.45 }

export function AthleteHomeScreen() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const navigate = useNavigate()
  const { athlete } = useAuth()
  const portal = useAthletePortal()
  const [tab, setTab] = useTabParam(PORTAL_TABS, 'home')
  const [historyView, setHistoryView] = useState<'list' | 'month'>('list')

  const progress = useMemo(() => (portal.data ? portalProgress(portal.data) : undefined), [portal.data])
  const ctx = useRecapContext(progress)
  const workouts = useMemo(() => (progress ? buildWorkouts(progress) : []), [progress])
  const names = useMemo(() => new Map((portal.data?.staff ?? []).map((m) => [m.id, m.displayName])), [portal.data])

  const totals = useMemo(() => {
    const sets = portal.data?.sets ?? []
    return {
      sessions: portal.data?.sessions.length ?? 0,
      sets: sessionSets(sets),
      volume: sessionVolume(sets),
    }
  }, [portal.data])

  const coachName = useMemo(() => {
    const coachId = portal.data?.athlete.coachMembershipId
    return coachId ? (portal.data?.staff.find((s) => s.id === coachId)?.displayName ?? null) : null
  }, [portal.data])

  const header = (
    <div style={headerRow}>
      <div style={{ minWidth: 0 }}>
        <p style={eyebrow}>{portal.data?.gym.name ?? athlete?.gymName ?? t('brand.name')}</p>
        <h1 className="display" style={titleStyle}>
          {portal.data?.athlete.fullName ?? athlete?.fullName ?? ''}
        </h1>
      </div>
      <button type="button" style={iconButton} aria-label={t('portal.account')} onClick={() => navigate('/me/account')}>
        <Icon name="settings" />
      </button>
    </div>
  )

  if (portal.isPending) {
    return (
      <Screen label={t('portal.title')} header={header}>
        <Spinner label={t('common.loading')} />
      </Screen>
    )
  }

  if (portal.isError || !portal.data) {
    const missing = portal.error instanceof Error && portal.error.message === ATHLETE_ACCOUNTS_MISSING
    return (
      <Screen label={t('portal.title')} header={header}>
        <EmptyState
          icon="alert"
          title={portal.isError ? t('portal.loadFailed') : t('portal.noAccess')}
          description={
            missing ? t('portal.notInstalled') : portal.isError ? t('portal.loadFailedHint') : t('portal.noAccessHint')
          }
          action={
            <Button icon="undo" onClick={() => void portal.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      </Screen>
    )
  }

  const data = portal.data
  const hasPlan = Boolean(data.athlete.planPhase || data.athlete.planFocus || coachName)
  const today = todayIn(data.gym.timezone)
  const insightProps = { athleteId: data.athlete.id, progress, memberships: data.staff, today }

  return (
    <Screen label={t('portal.title')} header={header}>
      <Tabs
        label={t('insights.tabsLabel')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'home', label: t('insights.tabHome'), icon: 'sparkle' },
          { id: 'history', label: t('insights.tabHistory'), icon: 'list' },
          { id: 'progress', label: t('insights.tabProgress'), icon: 'chart' },
          { id: 'records', label: t('insights.tabRecords'), icon: 'trophy' },
        ]}
      >
        {(open) => {
          switch (open) {
            case 'history':
              return (
                <section style={section} aria-label={t('athlete.history')}>
                  {workouts.length > 0 ? (
                    <Segmented
                      label={t('history.view')}
                      value={historyView}
                      options={[
                        { value: 'list', label: t('history.viewList') },
                        { value: 'month', label: t('history.viewMonth') },
                      ]}
                      onChange={setHistoryView}
                    />
                  ) : null}
                  {historyView === 'month' && workouts.length > 0 ? (
                    <Card>
                      <MonthCalendar workouts={workouts} ctx={ctx} names={names} today={today} showNotes={false} />
                    </Card>
                  ) : (
                    <HistoryList
                      sessions={data.sessions}
                      progress={progress}
                      memberships={data.staff}
                      onOpen={(sessionId) => navigate(`/me/sessions/${sessionId}`)}
                      emptyHint={t('portal.noSessionsHint')}
                    />
                  )}
                </section>
              )
            case 'progress':
              return (
                <>
                  <InsightsOverview {...insightProps} />
                  <ProgressView
                    athleteId={data.athlete.id}
                    progress={progress}
                    pending={false}
                    memberships={data.staff}
                    emptyHint={t('portal.noSessionsHint')}
                  />
                </>
              )
            case 'records':
              return <RecordsCard {...insightProps} />
            default:
              return (
                <>
                  {hasPlan ? (
                    <Card>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <h2 style={sectionHeading}>{t('portal.plan')}</h2>
                        {coachName ? <p style={planText}>{t('portal.coach', { name: coachName })}</p> : null}
                        {data.athlete.planPhase ? <p style={planText}>{data.athlete.planPhase}</p> : null}
                        {data.athlete.planFocus ? (
                          <p style={{ ...planText, color: 'var(--th-muted)' }}>{data.athlete.planFocus}</p>
                        ) : null}
                      </div>
                    </Card>
                  ) : null}

                  <div style={statsGrid} data-testid="portal-stats">
                    <Card>
                      <span className="num display" style={statValue}>
                        {totals.sessions}
                      </span>
                      <span style={statLabel}>{t('athlete.statSessions')}</span>
                    </Card>
                    <Card>
                      <span className="num display" style={statValue}>
                        {totals.sets}
                      </span>
                      <span style={statLabel}>{t('log.totalSets')}</span>
                    </Card>
                    <Card>
                      <span className="num display" style={statValue}>
                        {formatVolume(totals.volume, locale)}
                      </span>
                      <span style={statLabel}>{t('log.totalVolume')}</span>
                    </Card>
                  </div>

                  <InsightsOverview {...insightProps} />
                  <RecordsCard {...insightProps} limit={3} title={t('insights.recent')} />
                </>
              )
          }
        }}
      </Tabs>
    </Screen>
  )
}
