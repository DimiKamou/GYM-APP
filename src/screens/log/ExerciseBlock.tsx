import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { useLastPerformance } from '@/data/hooks'
import { blockEquipment } from '@/domain/analytics'
import { formatLastPerformance, type Locale } from '@/domain/format'
import type { Block, Exercise, SetKind, Uuid, WorkoutSet } from '@/domain/types'
import { Button, Card, CategoryPill, Icon } from '@/ui'
import { exerciseName } from '@/screens/log/ExercisePicker'
import { SetRow, type SetField } from '@/screens/log/SetRow'

/**
 * One exercise inside the session: its name, what this athlete did last time, its sets.
 *
 * The last-time line is the reason this component exists rather than a bare list of rows. It
 * renders through `formatLastPerformance`, which is "80×8 · 12 Αυγ · Μαρία" — the number, the
 * date and the coach who wrote it, always all three. A bare "80×8" is worse than showing
 * nothing, because the coach reads it and loads a bar with it without being able to ask anyone
 * whether it was a warm-up, a top set or someone else's athlete.
 *
 * The implement rides on the same line, and the question is asked WITH this block's own: the
 * last time the athlete did this movement with dumbbells is not the number to load a barbell
 * with, and "40×8 · Αλτήρες" says so where "40×8" would not.
 */

export interface ExerciseBlockProps {
  block: Block & { sets: WorkoutSet[] }
  /** Undefined only while the catalogue is still loading. */
  exercise: Exercise | undefined
  athleteId: Uuid
  sessionId: Uuid
  locale: Locale
  onPickExercise: () => void
  onAddSet: () => void
  onRepeatLast: () => void
  onEditSet: (set: WorkoutSet, field: SetField) => void
  onDeleteSet: (set: WorkoutSet) => void
  onRemove: () => void
}

const head: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }

const nameButton: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 6px',
  marginLeft: -6,
  borderRadius: 'var(--th-r-xs)',
  background: 'transparent',
  color: 'var(--th-ink)',
  fontSize: 'var(--th-text-md)',
  fontWeight: 700,
  textAlign: 'left',
}

const lastLine: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 20,
}

const implementTag: CSSProperties = {
  flex: '0 0 auto',
  fontSize: 'var(--th-text-sm)',
  fontWeight: 500,
  color: 'var(--th-muted)',
}

const blockNote: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  whiteSpace: 'pre-wrap',
}

const setList: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }

const actions: CSSProperties = { display: 'flex', gap: 8 }

/** The kind a new set takes: whatever this block is already logging, else the movement's own. */
export function blockSetKind(block: { sets: WorkoutSet[] }, exercise: Exercise | undefined): SetKind {
  const last = block.sets[block.sets.length - 1]
  return last?.kind ?? exercise?.defaultSetKind ?? 'weight_reps'
}

export function ExerciseBlock({
  block,
  exercise,
  athleteId,
  sessionId,
  locale,
  onPickExercise,
  onAddSet,
  onRepeatLast,
  onEditSet,
  onDeleteSet,
  onRemove,
}: ExerciseBlockProps) {
  const { t } = useTranslation()
  // Excluding this session is what stops "last time" from showing the set the coach just
  // logged two rows below, which reads as progress that has not happened.
  const last = useLastPerformance(athleteId, exercise?.id, sessionId, block.equipment)
  const name = exerciseName(exercise, locale)
  const hasSets = block.sets.length > 0
  const implement = blockEquipment(block, exercise)

  return (
    <Card>
      <div style={head}>
        {exercise ? <CategoryPill category={exercise.category} dotOnly /> : null}

        <button type="button" className="th-tap" style={nameButton} onClick={onPickExercise}>
          <span>{name || t('log.exercise')}</span>
          <Icon name="chevron" size={16} strokeWidth={2} />
        </button>

        {/* Shown only when this block departs from the exercise's own implement: that is the
            one case where the name alone would let 40 kg of dumbbells read as barbell work. */}
        {block.equipment ? <span style={implementTag}>{t(`equipmentTypes.${block.equipment}`)}</span> : null}

        {/* Removal is offered only for an EMPTY block. There is no `restoreBlock` in the
            repository, so removing a block with sets would be the one unrecoverable action on
            this screen — and the repair a coach actually needs (the sets are right, the
            exercise is wrong) is retargeting the block through the name button above, which
            keeps every set and its author.
            That is also what makes it safe to sit a thumb's width from the name button: while
            there is anything to lose, this control is disabled. */}
        <Button
          variant="dangerQuiet"
          size="sm"
          icon="trash"
          onClick={onRemove}
          disabled={hasSets}
          aria-label={hasSets ? t('log.removeBlocked') : `${t('log.removeExercise')} — ${name}`}
        />
      </div>

      <p style={lastLine}>
        {last.data ? (
          <>
            <span style={{ fontWeight: 700, color: 'var(--th-faint)' }}>{t('log.lastTime')}</span>
            <span className="num" style={{ color: 'var(--th-ink)', fontWeight: 600 }}>
              {formatLastPerformance(last.data, locale)}
              {implement ? ` · ${t(`equipmentTypes.${implement}`)}` : ''}
            </span>
          </>
        ) : (
          <span>{t('log.firstTime')}</span>
        )}
      </p>

      {/* Written by whoever logged the workout, about this workout — the pilot client lets a
          coach write it; here it is read, because a covering coach must not miss "πονάει ο
          ώμος, πήγαμε ελαφρύ" just because they hold a different phone. */}
      {block.note ? <p style={blockNote}>{block.note}</p> : null}

      {hasSets ? (
        <div style={setList}>
          {block.sets.map((set, index) => (
            <SetRow
              key={set.id}
              set={set}
              index={index + 1}
              exerciseName={name}
              locale={locale}
              onEdit={(field) => onEditSet(set, field)}
              onDelete={() => onDeleteSet(set)}
            />
          ))}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 'var(--th-text-sm)', color: 'var(--th-faint)' }}>
          {t('log.noSets')}
        </p>
      )}

      <div style={actions}>
        <Button variant="secondary" icon="plus" onClick={onAddSet} disabled={!exercise}>
          {t('log.addSet')}
        </Button>
        {/* One tap for the commonest set in personal training: the same thing again. It clones
            the previous row outright rather than opening the pad on it. */}
        <Button variant="quiet" icon="copy" onClick={onRepeatLast} disabled={!hasSets}>
          {t('log.sameAsPrevious')}
        </Button>
      </div>
    </Card>
  )
}
