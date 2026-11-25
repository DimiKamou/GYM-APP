import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth, useGymId } from '@/auth/useAuth'
import { useAthletes, useCreateSession } from '@/data/hooks'
import { newId } from '@/data/ids'
import { useOpenSessions } from '@/data/openSessions'
import { MAX_OPEN_SESSIONS, neighbourOf } from '@/domain/openSessions'
import { matches } from '@/domain/text'
import type { Athlete, Uuid } from '@/domain/types'
import { afterSheetClosed, Avatar, Icon, Input, Sheet } from '@/ui'

/**
 * One tab per athlete in the room. A personal session for two or three people is two or three
 * workouts — each the athlete's own sheet, each attributed to its coach — logged in turns: a set
 * for Νίκος, a set for Ελένη, back to Νίκος. Switching tabs replaces the address rather than
 * pushing it, so back still leaves the log instead of walking through every switch.
 *
 * The list lives on this phone (src/data/openSessions.ts) and expires by itself, so yesterday's
 * group never sits above today's workout.
 */

const shortName = (athlete: Athlete | undefined, all: readonly Athlete[]): string => {
  if (!athlete) return '…'
  const [first, ...rest] = athlete.fullName.trim().split(/\s+/)
  // Two Νίκος in one room: add the surname's initial, or a set goes on the wrong sheet.
  const clash = all.some((a) => a.id !== athlete.id && a.fullName.trim().split(/\s+/)[0] === first)
  return clash && rest.length > 0 ? `${first} ${rest[rest.length - 1][0]}.` : first
}

const closeButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  minHeight: 46,
  marginLeft: -6,
  color: 'var(--th-muted)',
}

export function SessionTabs({ sessionId, athleteId }: { sessionId: Uuid; athleteId: Uuid }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const gymId = useGymId()
  const { membership } = useAuth()
  const { list, close } = useOpenSessions(gymId, membership?.id ?? null)
  const roster = useAthletes()
  const athletes = useMemo(() => roster.data ?? [], [roster.data])
  const byId = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes])
  const [picking, setPicking] = useState(false)

  // The current workout is always a tab, even in the instant before the list catches up.
  const tabs = list.some((e) => e.sessionId === sessionId) ? list : [...list, { sessionId, athleteId, openedAt: 0 }]
  const inRoom = tabs.map((e) => byId.get(e.athleteId)).filter((a): a is Athlete => !!a)

  const go = (id: Uuid) => navigate(`/log/${id}`, { replace: true })

  return (
    <>
      <div className="th-tabs" data-testid="session-tabs">
        <nav aria-label={t('log.openWorkouts')} className="th-tabs__strip">
          {tabs.map((entry) => {
            const current = entry.sessionId === sessionId
            const athlete = byId.get(entry.athleteId)
            return (
              <span key={entry.sessionId} style={{ display: 'inline-flex', alignItems: 'center', position: 'relative' }}>
                <button
                  type="button"
                  className="th-tabs__tab th-tabs__link"
                  aria-current={current ? 'page' : undefined}
                  onClick={() => (current ? undefined : go(entry.sessionId))}
                >
                  <span className="th-session-tab__avatar" aria-hidden="true">
                    <Avatar fullName={athlete?.fullName ?? '?'} size={24} />
                  </span>
                  <span>{shortName(athlete, inRoom)}</span>
                  {current ? <span aria-hidden="true" className="th-tabs__underline" /> : null}
                </button>
                {current && tabs.length > 1 ? (
                  <button
                    type="button"
                    style={closeButton}
                    aria-label={t('log.closeWorkoutTab', { name: athlete?.fullName ?? '' })}
                    onClick={() => {
                      const next = neighbourOf(tabs, entry.sessionId)
                      close(entry.sessionId)
                      if (next) go(next.sessionId)
                    }}
                  >
                    <Icon name="x" size={16} />
                  </button>
                ) : null}
              </span>
            )
          })}
          {tabs.length < MAX_OPEN_SESSIONS ? (
            <button type="button" className="th-tabs__tab" onClick={() => setPicking(true)}>
              <Icon name="plus" size={17} />
              <span>{t('log.addAthleteTab')}</span>
            </button>
          ) : null}
        </nav>
      </div>
      <AthletePickSheet
        open={picking}
        exclude={new Set(tabs.map((e) => e.athleteId))}
        athletes={athletes}
        onClose={() => setPicking(false)}
        onStarted={(id) => afterSheetClosed(() => go(id))}
      />
    </>
  )
}

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  minHeight: 52,
  padding: '6px 4px',
  textAlign: 'left',
  color: 'var(--th-ink)',
  borderTop: '1px solid var(--th-line-soft)',
}

function AthletePickSheet({
  open,
  exclude,
  athletes,
  onClose,
  onStarted,
}: {
  open: boolean
  exclude: ReadonlySet<Uuid>
  athletes: readonly Athlete[]
  onClose: () => void
  onStarted: (sessionId: Uuid) => void
}) {
  const { t } = useTranslation()
  const gymId = useGymId()
  const { membership } = useAuth()
  const { open: openTab } = useOpenSessions(gymId, membership?.id ?? null)
  const createSession = useCreateSession()
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const shown = athletes.filter((a) => a.deletedAt === null && !exclude.has(a.id) && matches(a.fullName, search))

  async function start(athlete: Athlete) {
    if (busy) return
    setBusy(true)
    try {
      const id = newId()
      await createSession.mutateAsync({ id, athleteId: athlete.id })
      openTab(id, athlete.id)
      setSearch('')
      onClose()
      onStarted(id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('log.addAthleteTitle')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 'var(--th-text-sm)', color: 'var(--th-muted)', lineHeight: 1.45 }}>
          {t('log.addAthleteHint')}
        </p>
        <Input type="search" value={search} placeholder={t('athletes.searchPlaceholder')} aria-label={t('athletes.searchPlaceholder')} onChange={(e) => setSearch(e.target.value)} />
        <div data-testid="add-athlete-list">
          {shown.map((athlete, index) => (
            <button
              key={athlete.id}
              type="button"
              className="hit"
              disabled={busy}
              style={{ ...row, borderTop: index === 0 ? 'none' : row.borderTop }}
              onClick={() => void start(athlete)}
            >
              <Avatar fullName={athlete.fullName} />
              <span style={{ fontWeight: 600 }}>{athlete.fullName}</span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  )
}
