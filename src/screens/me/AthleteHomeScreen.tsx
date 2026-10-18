import { useMemo, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import { useAthletePortal } from '@/data/hooks'
import { ATHLETE_ACCOUNTS_MISSING } from '@/data/repo/types'
import { sessionSets, sessionVolume } from '@/domain/analytics'
import { formatVolume } from '@/domain/format'
import { currentLocale } from '@/i18n'
import { Button, Card, EmptyState, Icon, Screen, Spinner } from '@/ui'
import { HistoryList } from '@/screens/athlete/HistoryList'
import { ProgressView } from '@/screens/progress/ProgressSection'
import { portalProgress } from '@/screens/me/portal'

/**
 * The athlete's panel: their own sheet, read-only.
 *
 * Same order of importance as on paper, from the athlete's side of the clipboard: who is
 * training them and on what, then what they did, then whether it is going anywhere. Every
 * session row carries its date and the coach who wrote it, exactly as the staff see it — "who
 * wrote this line" is the product, and an athlete asking "who put 80 on that?" deserves the
 * same answer the covering coach gets.
 *
 * What is NOT here is the staff's own writing — notes, warnings, set remarks. The server never
 * sends it (see 012); nothing on this screen has to remember to hide it.
 */

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

  const progress = useMemo(() => (portal.data ? portalProgress(portal.data) : undefined), [portal.data])

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

  return (
    <Screen label={t('portal.title')} header={header}>
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

      <section style={section} aria-label={t('athlete.history')}>
        <h2 style={sectionHeading}>{t('athlete.history')}</h2>
        <HistoryList
          sessions={data.sessions}
          progress={progress}
          memberships={data.staff}
          onOpen={(sessionId) => navigate(`/me/sessions/${sessionId}`)}
          emptyHint={t('portal.noSessionsHint')}
        />
      </section>

      <ProgressView
        athleteId={data.athlete.id}
        progress={progress}
        pending={false}
        memberships={data.staff}
        emptyHint={t('portal.noSessionsHint')}
      />
    </Screen>
  )
}
