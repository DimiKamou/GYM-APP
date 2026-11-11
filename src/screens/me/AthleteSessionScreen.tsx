import { useMemo, type CSSProperties } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAthletePortal } from '@/data/hooks'
import { blockEquipment, sessionAuthorId, sessionSets, sessionVolume } from '@/domain/analytics'
import { formatDate, formatSet, formatVolume } from '@/domain/format'
import { currentLocale } from '@/i18n'
import type { Exercise, Uuid, WorkoutSet } from '@/domain/types'
import { Button, Card, EmptyState, Icon, Screen, Spinner } from '@/ui'
import { exerciseName } from '@/screens/progress/ProgressSection'
import { byPosition } from '@/screens/me/portal'

/**
 * One session, as the athlete sees it: read-only, every exercise with the tool it was done
 * with, every set in the units it was measured in.
 *
 * The date and the coach sit at the top of the screen, above every number below them. A set
 * on its own is "80×8" with nothing to say when or by whom — CLAUDE.md's rule is that a
 * coaching number never renders without both, and here the header carries them for the page.
 *
 * Built from the sheet already in memory (one read, `my_athlete_portal()`), so it opens with
 * no signal on the bus as readily as on the gym floor.
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

const titleStyle: CSSProperties = { fontSize: 'var(--th-text-xl)', margin: 0 }

const meta: CSSProperties = {
  margin: '4px 0 0',
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
}

const blockTitle: CSSProperties = { margin: 0, fontSize: 'var(--th-text-md)', fontWeight: 600 }

const blockMeta: CSSProperties = {
  margin: '2px 0 0',
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
}

const setList: CSSProperties = {
  listStyle: 'none',
  margin: '10px 0 0',
  padding: 0,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
}

const setChip: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 'var(--th-r-sm)',
  background: 'var(--th-surface-2)',
  border: '1px solid var(--th-line)',
  fontSize: 'var(--th-text-sm)',
}

const totalsRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
}

export function AthleteSessionScreen() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const navigate = useNavigate()
  const location = useLocation()
  const { sessionId } = useParams<'sessionId'>()
  const portal = useAthletePortal()

  const tree = useMemo(() => {
    const data = portal.data
    if (!data || !sessionId) return null
    const session = data.sessions.find((s) => s.id === sessionId)
    if (!session) return null
    const exercises = new Map<Uuid, Exercise>(data.exercises.map((e) => [e.id, e]))
    const blocks = data.blocks
      .filter((b) => b.sessionId === session.id)
      .sort(byPosition)
      .map((block) => ({
        block,
        exercise: exercises.get(block.exerciseId),
        sets: data.sets.filter((s) => s.blockId === block.id).sort(byPosition),
      }))
    const author = data.staff.find((s) => s.id === sessionAuthorId(session))?.displayName ?? null
    const allSets: WorkoutSet[] = blocks.flatMap((b) => b.sets)
    return { session, blocks, author, sets: allSets }
  }, [portal.data, sessionId])

  // A cold open (a shared link, a restored tab) has nothing behind it to pop.
  const goBack = () => (location.key === 'default' ? navigate('/me', { replace: true }) : navigate(-1))

  const back = (
    <button type="button" onClick={goBack} aria-label={t('common.back')} style={backButton}>
      <Icon name="back" strokeWidth={1.8} />
    </button>
  )

  if (portal.isPending) {
    return (
      <Screen label={t('log.title')} header={back}>
        <Spinner label={t('common.loading')} />
      </Screen>
    )
  }

  if (!tree) {
    return (
      <Screen label={t('log.title')} header={back}>
        <EmptyState
          icon="alert"
          title={t('portal.sessionMissing')}
          action={
            <Button icon="back" onClick={() => navigate('/me', { replace: true })}>
              {t('portal.backToSheet')}
            </Button>
          }
        />
      </Screen>
    )
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      {back}
      <div style={{ minWidth: 0 }}>
        <h1 className="display" style={titleStyle}>
          {tree.session.title ?? t('log.title')}
        </h1>
        <p style={meta}>
          <span className="num">{formatDate(tree.session.localDate, locale)}</span>
          {tree.author ? (
            <>
              <Icon name="users" size={14} />
              {tree.author}
            </>
          ) : null}
        </p>
      </div>
    </div>
  )

  return (
    <Screen label={t('log.title')} header={header}>
      {tree.blocks.length === 0 ? (
        <EmptyState icon="dumbbell" title={t('portal.emptySession')} />
      ) : (
        tree.blocks.map(({ block, exercise, sets }) => {
          const tool = blockEquipment(block, exercise)
          return (
            <Card key={block.id}>
              <h2 style={blockTitle}>{exercise ? exerciseName(exercise, locale) : t('portal.unknownExercise')}</h2>
              {tool ? <p style={blockMeta}>{t(`equipmentTypes.${tool}`)}</p> : null}
              <ul style={setList} aria-label={t('portal.setsOf', { name: exercise ? exerciseName(exercise, locale) : '' })}>
                {sets.map((set) => (
                  <li key={set.id} className="num" style={setChip}>
                    {formatSet(set, set.kind, locale)}
                  </li>
                ))}
              </ul>
            </Card>
          )
        })
      )}

      <Card tone="flat">
        <div style={totalsRow}>
          <span>{t('log.totalSets')}</span>
          <span className="num">{sessionSets(tree.sets)}</span>
        </div>
        <div style={{ ...totalsRow, marginTop: 6 }}>
          <span>{t('log.totalVolume')}</span>
          <span className="num">{formatVolume(sessionVolume(tree.sets), locale)}</span>
        </div>
      </Card>
    </Screen>
  )
}
