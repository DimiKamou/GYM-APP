import { useMemo, type CSSProperties } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import { useAthletes, useDayAppointments, useGymSessions, useInvites, useLastSessionDates, useTeam } from '@/data/hooks'
import { shiftLocalDate } from '@/domain/calendar'
import { DRIFT_DAYS, gymDashboard, type CoachActivity, type DriftingAthlete } from '@/domain/dashboard'
import { formatDate } from '@/domain/format'
import { currentLocale } from '@/i18n'
import { Avatar, Button, Card, EmptyState, Screen, Spinner, Tabs, useTabParam } from '@/ui'
import { todayIn } from '@/screens/calendar/WeekStrip'
import { FrequencyBars, StatTiles } from '@/screens/insights/Insights'

/**
 * Πίνακας — the owner's view of the whole gym. Owner-only: a trainer who types the address is
 * sent to the roster, and the tab is not in their bar.
 *
 * Three tabs, three questions: how busy was the gym (Επισκόπηση), who is drifting away and
 * worth a phone call (Αθλητές), and who did the work this month (Ομάδα). Every name is a door to
 * that athlete's sheet; nothing here is a number without a name and a date behind it.
 */

const TABS = ['overview', 'athletes', 'team'] as const

const label: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
}

const muted: CSSProperties = { margin: 0, fontSize: 'var(--th-text-sm)', color: 'var(--th-muted)', lineHeight: 1.45 }

const rowButton: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '40px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  minHeight: 56,
  padding: '8px 0',
  textAlign: 'left',
  color: 'var(--th-ink)',
  borderTop: '1px solid var(--th-line-soft)',
}

export function DashboardScreen() {
  const { membership } = useAuth()
  if (membership?.role !== 'owner') return <Navigate to="/athletes" replace />
  return <DashboardBody />
}

function DashboardBody() {
  const { t } = useTranslation()
  const { gym } = useAuth()
  const today = todayIn(gym?.timezone ?? '')
  const from = shiftLocalDate(today, -7 * 12)
  const sessions = useGymSessions(from)
  const roster = useAthletes()
  const team = useTeam()
  const appointments = useDayAppointments(today)
  const athletes = useMemo(() => roster.data ?? [], [roster.data])
  const lastByAthlete = useLastSessionDates(athletes)
  const [tab, setTab] = useTabParam(TABS, 'overview')
  const navigate = useNavigate()
  const invites = useInvites()
  // listInvites() is the pending list, as the Team screen reads it.
  const pendingInvites = (invites.data ?? []).length

  // Not memoised: useLastSessionDates hands back a fresh Map every render, and the work is a
  // few hundred rows at most.
  const data = gymDashboard({
    sessions: sessions.data ?? [],
    athletes,
    members: team.data ?? [],
    lastByAthlete,
    today,
  })

  const header = (
    <div>
      <p style={label}>{gym?.name ?? t('brand.name')}</p>
      <h1 className="display" style={{ margin: '4px 0 0', fontSize: 'var(--th-text-2xl)' }}>
        {t('dashboard.title')}
      </h1>
    </div>
  )

  const loading = sessions.isPending || roster.isPending || team.isPending
  const todayCount = (appointments.data ?? []).length

  return (
    <Screen label={t('dashboard.title')} header={header} footerSafeArea={false}>
      <Tabs
        label={t('dashboard.tabsLabel')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: t('dashboard.tabOverview'), icon: 'chart' },
          { id: 'athletes', label: t('dashboard.tabAthletes'), icon: 'athletes', badge: data.drifting.length },
          { id: 'team', label: t('dashboard.tabTeam'), icon: 'team' },
        ]}
      >
        {(open) => {
          if (loading) return <Spinner label={t('common.loading')} />
          if (open === 'athletes') return <DriftList drifting={data.drifting} />
          if (open === 'team')
            return (
              <>
                <Button variant="secondary" block icon="team" trailingIcon="chevron" onClick={() => navigate('/team')}>
                  {t('dashboard.manageTeam')}
                  {pendingInvites > 0 ? (
                    <span className="th-tabs__badge num" aria-label={t('dashboard.pendingInvites', { count: pendingInvites })}>
                      {pendingInvites}
                    </span>
                  ) : null}
                </Button>
                <TeamActivity coaches={data.coaches} />
              </>
            )
          return (
            <>
              <StatTiles
                tiles={[
                  { icon: 'flame', value: data.thisWeek, label: t('dashboard.weekVs', { count: data.lastWeek }) },
                  { icon: 'athletes', value: `${data.activeAthletes}/${data.totalAthletes}`, label: t('dashboard.activeAthletes') },
                  { icon: 'calendar', value: todayCount, label: t('dashboard.today') },
                  { icon: 'alert', value: data.drifting.length, label: t('dashboard.drifting') },
                ]}
              />
              <Card>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <h2 style={label}>{t('dashboard.gymWeeks')}</h2>
                  <FrequencyBars weeks={data.weeks} />
                </div>
              </Card>
            </>
          )
        }}
      </Tabs>
    </Screen>
  )
}

function DriftList({ drifting }: { drifting: DriftingAthlete[] }) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const navigate = useNavigate()
  if (drifting.length === 0) return <EmptyState icon="check" title={t('dashboard.allGood')} />
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 style={label}>{t('dashboard.drifting')}</h2>
        <p style={muted}>{t('dashboard.driftHint', { days: DRIFT_DAYS })}</p>
        <div data-testid="drifting">
          {drifting.map((row, index) => (
            <button
              key={row.athlete.id}
              type="button"
              className="hit"
              style={{ ...rowButton, borderTop: index === 0 ? 'none' : rowButton.borderTop }}
              onClick={() => navigate(`/athletes/${row.athlete.id}`)}
            >
              <Avatar fullName={row.athlete.fullName} />
              <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <strong style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.athlete.fullName}
                </strong>
                <span style={{ fontSize: 'var(--th-text-xs)', color: 'var(--th-muted)' }}>
                  {row.lastDate ? t('dashboard.lastOn', { date: formatDate(row.lastDate, locale) }) : t('dashboard.never')}
                </span>
              </span>
              <span className="num" style={{ fontWeight: 700, color: row.daysSince === null ? 'var(--th-muted)' : 'var(--th-brand)' }}>
                {row.daysSince === null ? '—' : t('dashboard.daysAgo', { count: row.daysSince })}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Card>
  )
}

export function TeamActivity({ coaches }: { coaches: CoachActivity[] }) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const max = Math.max(1, ...coaches.map((c) => c.sessions))
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="team-activity">
        <h2 style={label}>{t('dashboard.teamTitle')}</h2>
        <p style={muted}>{t('dashboard.teamHint')}</p>
        {coaches.map((coach) => (
          <div key={coach.member.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderTop: '1px solid var(--th-line-soft)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <strong style={{ fontWeight: 650 }}>{coach.member.displayName}</strong>
              <span className="num" style={{ fontWeight: 700 }}>{t('counts.session', { count: coach.sessions })}</span>
            </div>
            <div aria-hidden="true" style={{ height: 8, borderRadius: 4, background: 'var(--th-surface-3)', overflow: 'hidden' }}>
              <div style={{ width: `${(coach.sessions / max) * 100}%`, height: '100%', background: 'var(--th-brand)', borderRadius: 4 }} />
            </div>
            <span style={{ fontSize: 'var(--th-text-xs)', color: 'var(--th-muted)' }}>
              {coach.sessions === 0
                ? t('dashboard.noActivity')
                : [t('counts.athlete', { count: coach.athletes }), coach.lastDate ? t('dashboard.lastOn', { date: formatDate(coach.lastDate, locale) }) : null]
                    .filter(Boolean)
                    .join(' · ')}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
