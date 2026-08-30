import { useMemo, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useGymId } from '@/auth/useAuth'
import { newId } from '@/data/ids'
import {
  useAddBlock,
  useAthlete,
  useAthleteSessions,
  useBriefing,
  useCreateSession,
  useNotes,
  useProgressData,
  useRepo,
  useTeam,
} from '@/data/hooks'
import { sessionSets, sessionVolume } from '@/domain/analytics'
import { formatVolume } from '@/domain/format'
import { currentLocale } from '@/i18n'
import type { Uuid } from '@/domain/types'
import { Button, Card, EmptyState, Icon, Screen, Spinner } from '@/ui'
import { BriefingCard } from '@/screens/athlete/BriefingCard'
import { HistoryList } from '@/screens/athlete/HistoryList'
import { NoteComposer, NoteFeed } from '@/screens/athlete/NoteComposer'
import { AthleteSheet } from '@/screens/athlete/AthleteSheet'
import { ProgressSection } from '@/screens/progress/ProgressSection'

/**
 * One athlete.
 *
 * The order of this screen IS the design. The briefing card is first and alone above the fold:
 * name and coach, the pinned warnings, the last note verbatim, one line of what was actually
 * lifted last time and by whom, and two ways to start. The three stat tiles and the whole
 * Progress section come after it, because at 08:29 with the athlete walking over, "sessions /
 * sets / volume" answers a question nobody is asking.
 *
 * "Επανάληψη" copies the last session's EXERCISES into a new one and none of its sets. Copying
 * the loads would write numbers nobody performed under today's date and under this coach's
 * name, which is the one thing this app must never do.
 */

const backButton: CSSProperties = {
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

const statValue: CSSProperties = {
  fontSize: 'var(--th-text-lg)',
  color: 'var(--th-ink)',
  display: 'block',
}

const statLabel: CSSProperties = {
  display: 'block',
  marginTop: 4,
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
}

const sectionHeading: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
}

const section: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--th-gap)' }

export function AthleteDetailScreen() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const { athleteId } = useParams<'athleteId'>()
  const navigate = useNavigate()
  const location = useLocation()
  const gymId = useGymId()
  const repo = useRepo()

  const briefing = useBriefing(athleteId)
  const athlete = useAthlete(athleteId)
  const sessions = useAthleteSessions(athleteId)
  const progress = useProgressData(athleteId)
  const notes = useNotes(athleteId)
  const team = useTeam()

  const createSession = useCreateSession()
  const addBlock = useAddBlock()
  const [starting, setStarting] = useState(false)
  const [editing, setEditing] = useState(false)

  // `key === 'default'` is the router's first history entry: the trainer opened this URL cold
  // (a shared link, a home-screen shortcut), so there is nothing behind it to pop.
  const goBack = () =>
    location.key === 'default' ? navigate('/athletes', { replace: true }) : navigate(-1)

  const totals = useMemo(() => {
    const sets = progress.data?.sets ?? []
    return {
      sessions: (progress.data?.sessions ?? []).filter((s) => s.deletedAt === null).length,
      sets: sessionSets(sets),
      volume: sessionVolume(sets),
    }
  }, [progress.data])

  const startSession = async (title: string | null, copyFrom: Uuid | null) => {
    if (!athleteId || starting) return
    setStarting(true)
    try {
      const id = newId()
      await createSession.mutateAsync({ id, athleteId, title })
      if (copyFrom) await copyExercises(copyFrom, id)
      navigate(`/log/${id}`)
    } finally {
      setStarting(false)
    }
  }

  /**
   * The exercises of a previous session, in order, as empty blocks.
   *
   * A failed read here must not swallow the session that was already created: the coach ends
   * up in an empty log, which is exactly where "Νέα προπόνηση" would have put them.
   */
  const copyExercises = async (fromSessionId: Uuid, intoSessionId: Uuid) => {
    try {
      const tree = await repo.getSessionTree(gymId, fromSessionId)
      const blocks = tree?.blocks ?? []
      for (let index = 0; index < blocks.length; index++) {
        await addBlock.mutateAsync({
          sessionId: intoSessionId,
          blockId: newId(),
          exerciseId: blocks[index].exerciseId,
          position: index,
        })
      }
    } catch {
      // Nothing to tell the coach that the empty log in front of them does not already say.
    }
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
      <button type="button" onClick={goBack} aria-label={t('common.back')} style={backButton}>
        <Icon name="back" strokeWidth={1.8} />
      </button>
      {athlete.data ? (
        <Button variant="quiet" icon="edit" onClick={() => setEditing(true)}>
          {t('common.edit')}
        </Button>
      ) : null}
    </div>
  )

  if (briefing.isPending || !athleteId) {
    return (
      <Screen label={t('athlete.briefing')} header={header}>
        <Spinner label={t('common.loading')} />
      </Screen>
    )
  }

  if (!briefing.data) {
    return (
      <Screen label={t('athlete.briefing')} header={header}>
        <EmptyState
          icon="alert"
          title={t('athlete.notFound')}
          description={t('athlete.notFoundHint')}
          action={
            <Button icon="back" onClick={() => navigate('/athletes', { replace: true })}>
              {t('errors.backToAthletes')}
            </Button>
          }
        />
      </Screen>
    )
  }

  const lastSessionId = briefing.data.lastSession?.id ?? null

  return (
    <Screen label={t('athlete.briefing')} header={header}>
      <BriefingCard
        briefing={briefing.data}
        busy={starting}
        onNewSession={() => void startSession(null, null)}
        onRepeat={() =>
          void startSession(briefing.data?.lastSession?.title ?? null, lastSessionId)
        }
      />

      <div style={statsGrid} data-testid="stats">
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
          sessions={sessions.data ?? []}
          progress={progress.data}
          memberships={team.data ?? []}
          onOpen={(sessionId) => navigate(`/log/${sessionId}`)}
        />
      </section>

      <section style={section} aria-label={t('notes.title')}>
        <h2 style={sectionHeading}>{t('notes.title')}</h2>
        <NoteComposer athleteId={athleteId} />
        <NoteFeed athleteId={athleteId} notes={notes.data ?? []} />
      </section>

      <ProgressSection athleteId={athleteId} />

      <AthleteSheet
        open={editing}
        onClose={() => setEditing(false)}
        athlete={athlete.data}
        onArchived={() => navigate('/athletes', { replace: true })}
      />
    </Screen>
  )
}
