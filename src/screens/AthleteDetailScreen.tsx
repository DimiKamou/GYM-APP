import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth, useGymId } from '@/auth/useAuth'
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
import { Button, Card, EmptyState, Icon, Screen, Sheet, Spinner } from '@/ui'
import { BriefingCard } from '@/screens/athlete/BriefingCard'
import { HistoryList } from '@/screens/athlete/HistoryList'
import { NoteComposer, NoteFeed } from '@/screens/athlete/NoteComposer'
import { AthleteSheet } from '@/screens/athlete/AthleteSheet'
import { PrintSheet, type PrintVariant } from '@/screens/athlete/PrintSheet'
import { ProgressSection } from '@/screens/progress/ProgressSection'
import { todayIn } from '@/screens/calendar/WeekStrip'

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
 *
 * Printing hangs off the header rather than off anything near the bottom of the frame. It is a
 * desk action — a coach prints the sheet before the day starts, or when a phone has died — and
 * the bottom third of this screen is where a thumb lands all session long.
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

const headerActions: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }

const printOptions: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }

const printHint: CSSProperties = {
  margin: '0 0 6px',
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  lineHeight: 1.4,
}

export function AthleteDetailScreen() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const { athleteId } = useParams<'athleteId'>()
  const navigate = useNavigate()
  const location = useLocation()
  const gymId = useGymId()
  const repo = useRepo()
  // `useGymId()` throws unless a membership is resolved, so the gym is present by this line;
  // the fallbacks below are what the nullable type demands, not a state that can occur.
  const { gym } = useAuth()
  const gymName = gym?.name ?? ''
  const timeZone = gym?.timezone ?? ''

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

  const [printChoice, setPrintChoice] = useState(false)
  const [printVariant, setPrintVariant] = useState<PrintVariant>('filled')
  const [printedOn, setPrintedOn] = useState(() => todayIn(timeZone))
  // Bumped rather than set: printing the same sheet twice in a row is a normal thing to want.
  const [printJob, setPrintJob] = useState(0)

  const startPrint = (variant: PrintVariant) => {
    setPrintVariant(variant)
    setPrintedOn(todayIn(timeZone))
    setPrintChoice(false)
    setPrintJob((job) => job + 1)
  }

  /**
   * The dialog is opened from a task, not from the click handler: the chosen variant has to be
   * in the DOM and the bottom sheet gone from it before the browser snapshots the page.
   */
  useEffect(() => {
    if (printJob === 0) return
    const timer = window.setTimeout(() => {
      try {
        window.print()
      } catch {
        // A browser with printing disabled. Nothing to say that a missing dialog does not.
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [printJob])

  /**
   * The footer must carry the day the paper came out of the printer, including when the print
   * came from the browser's own menu. A screen left open overnight would otherwise date the
   * sheet yesterday, and a printout dated wrong is worse than one not dated at all.
   *
   * `flushSync` because the dialog reads the DOM the moment this listener returns; a batched
   * update lands after the snapshot. Safari does not fire the event at all, which is why
   * `startPrint` sets the date as well.
   */
  useEffect(() => {
    const refresh = () => flushSync(() => setPrintedOn(todayIn(timeZone)))
    window.addEventListener('beforeprint', refresh)
    return () => window.removeEventListener('beforeprint', refresh)
  }, [timeZone])

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
      <div style={headerActions}>
        {briefing.data ? (
          <Button
            variant="quiet"
            onClick={() => setPrintChoice(true)}
            // The sheet prints the sessions and their coaches, so offering it before those
            // have arrived would print an athlete whose history looks empty.
            disabled={progress.isPending || team.isPending}
          >
            {t('print.action')}
          </Button>
        ) : null}
        {athlete.data ? (
          <Button variant="quiet" icon="edit" onClick={() => setEditing(true)}>
            {t('common.edit')}
          </Button>
        ) : null}
      </div>
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

      <Sheet
        open={printChoice}
        onClose={() => setPrintChoice(false)}
        title={t('print.chooseTitle')}
      >
        <div style={printOptions}>
          <Button block variant="primary" onClick={() => startPrint('filled')}>
            {t('print.filled')}
          </Button>
          <p style={printHint}>{t('print.filledHint')}</p>
          <Button block onClick={() => startPrint('blank')}>
            {t('print.blank')}
          </Button>
          <p style={printHint}>{t('print.blankHint')}</p>
        </div>
      </Sheet>

      {/* Portalled to `<body>` rather than rendered here, because the app frame is a clipped
          `100dvh` column and a sheet inside it prints as the one screenful that fits. It stays
          mounted so the browser's own Print command produces the athlete's sheet too, rather
          than a blank page. `print.css` hides everything else. */}
      {typeof document === 'undefined'
        ? null
        : createPortal(
            <PrintSheet
              gymName={gymName}
              athlete={athlete.data ?? briefing.data.athlete}
              coachName={briefing.data.coachName}
              pinnedNotes={briefing.data.pinnedNotes}
              sessions={sessions.data ?? []}
              progress={progress.data}
              memberships={team.data ?? []}
              printedOn={printedOn}
              variant={printVariant}
              locale={locale}
            />,
            document.body,
          )}
    </Screen>
  )
}
