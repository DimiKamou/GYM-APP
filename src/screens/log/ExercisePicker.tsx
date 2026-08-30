import { useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { newId } from '@/data/ids'
import { useCreateExercise, useExercises, useRecentExercises } from '@/data/hooks'
import type { Locale } from '@/domain/format'
import { matches } from '@/domain/text'
import type { Exercise, ExerciseCategory, SetKind, Uuid } from '@/domain/types'
import { Button, CategoryPill, Field, Input, Segmented, Sheet } from '@/ui'

/**
 * The exercise picker.
 *
 * Two decisions carry it, and both are corrections of the prototype:
 *
 *  - **It opens on this athlete's recent eight**, as full-width rows one tap each. Personal
 *    training is repetitive; the movement the coach wants is almost always one they did with
 *    this athlete last week, and a search box is three seconds and a spelling.
 *  - **It is NEVER pre-filtered by the block's current category.** The prototype filtered the
 *    list to the category of the exercise already in the block, which is a hidden dead end: a
 *    coach looking for "Έλξεις" in a "lower" block sees nothing, concludes it is missing, and
 *    creates a duplicate — and from then on the athlete's chart for that movement is forked
 *    across two rows that no report will ever add back together.
 *
 * Search is diacritic- and final-sigma-insensitive through `matches`, so "πιεσεις" finds
 * "Πιέσεις Στήθους", and it looks at both names — half the catalogue is bilingual.
 */

/**
 * The name to show. Greek first because the UI is Greek; the other name is the fallback so a
 * catalogue row with only one of the two never renders as an empty button.
 *
 * Exported here rather than in a shared module because the picker is the screen that owns
 * "what is this exercise called" — the block header renders the same string.
 */
export function exerciseName(exercise: Exercise | undefined, locale: Locale): string {
  if (!exercise) return ''
  const primary = locale === 'en' ? exercise.nameEn : exercise.nameEl
  const secondary = locale === 'en' ? exercise.nameEl : exercise.nameEn
  return primary ?? secondary ?? ''
}

const CATEGORIES: readonly ExerciseCategory[] = ['upper', 'lower', 'core', 'cardio', 'mobility']
const SET_KINDS: readonly SetKind[] = ['weight_reps', 'bodyweight', 'duration', 'distance']

export interface ExercisePickerProps {
  open: boolean
  onClose: () => void
  athleteId: Uuid | undefined
  locale: Locale
  /** The chosen exercise. The caller decides whether that adds a block or re-points one. */
  onSelect: (exerciseId: Uuid) => void
}

const list: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  minHeight: 56,
  padding: '0 12px',
  borderRadius: 'var(--th-r-sm)',
  background: 'var(--th-surface-2)',
  color: 'var(--th-ink)',
  textAlign: 'left',
  fontSize: 'var(--th-text-md)',
  fontWeight: 600,
}

const sectionLabel: CSSProperties = {
  fontSize: 'var(--th-text-xs)',
  fontWeight: 700,
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
  margin: '4px 0 2px',
}

const metaText: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 'var(--th-text-xs)',
  color: 'var(--th-muted)',
  fontWeight: 500,
}

export function ExercisePicker({ open, onClose, athleteId, locale, onSelect }: ExercisePickerProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [category, setCategory] = useState<ExerciseCategory>('upper')
  const [setKind, setSetKind] = useState<SetKind>('weight_reps')

  const exercises = useExercises()
  const recent = useRecentExercises(athleteId, 8)
  const createExercise = useCreateExercise()

  const catalogue = useMemo(
    () => (exercises.data ?? []).filter((exercise) => !exercise.isArchived),
    [exercises.data],
  )

  const recentIds = useMemo(
    () => new Set((recent.data ?? []).map((entry) => entry.exercise.id)),
    [recent.data],
  )

  const hit = (exercise: Exercise) =>
    matches(exercise.nameEl ?? '', query) || matches(exercise.nameEn ?? '', query)

  const recentHits = (recent.data ?? []).filter((entry) => hit(entry.exercise))
  // The catalogue list deliberately excludes what the recent strip already shows, so the same
  // movement is never two rows apart in one sheet.
  const others = catalogue.filter((exercise) => !recentIds.has(exercise.id) && hit(exercise))
  const nothingFound = recentHits.length === 0 && others.length === 0

  function choose(exerciseId: Uuid) {
    reset()
    onSelect(exerciseId)
  }

  function reset() {
    setQuery('')
    setNameEn('')
  }

  function close() {
    reset()
    onClose()
  }

  async function create() {
    const nameEl = query.trim()
    if (nameEl === '') return
    const id = newId()
    // The id is minted here, so the block can point at it without waiting for the write —
    // which on the local repository is instant and on a queued write may be hours.
    await createExercise.mutateAsync({
      id,
      nameEl,
      nameEn: nameEn.trim() === '' ? null : nameEn.trim(),
      category,
      equipment: 'other',
      defaultSetKind: setKind,
    })
    choose(id)
  }

  function row(exercise: Exercise, meta?: string) {
    return (
      <button
        key={exercise.id}
        type="button"
        className="th-tap"
        style={rowStyle}
        onClick={() => choose(exercise.id)}
      >
        <CategoryPill category={exercise.category} dotOnly />
        <span>{exerciseName(exercise, locale)}</span>
        {meta ? <span style={metaText}>{meta}</span> : null}
      </button>
    )
  }

  return (
    <Sheet open={open} onClose={close} title={t('picker.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {recentHits.length > 0 ? (
          <>
            <p style={sectionLabel}>{t('picker.recent')}</p>
            <div style={list}>
              {recentHits.map((entry) =>
                row(entry.exercise, t('counts.session', { count: entry.timesUsed })),
              )}
            </div>
          </>
        ) : null}

        {/* Under the recent rows on purpose: the fast path must be the thing under the thumb
            when the sheet opens, and reaching the field is a deliberate second choice. */}
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('picker.searchOrType')}
          aria-label={t('picker.searchOrType')}
        />

        {others.length > 0 ? (
          <>
            <p style={sectionLabel}>{t('picker.allExercises')}</p>
            <div style={list}>{others.map((exercise) => row(exercise))}</div>
          </>
        ) : null}

        {nothingFound && query.trim() !== '' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, color: 'var(--th-muted)' }}>
              {t('picker.noMatches')} — {t('picker.addCustomHint')}
            </p>

            {/* The Greek name is what the coach just typed, so it is already correct and is
                not asked for again. English is the optional courtesy, never the required one. */}
            <Field label={t('library.nameEl')} hint={t('picker.createHint')}>
              {({ id }) => <Input id={id} value={query} readOnly aria-readonly="true" />}
            </Field>

            <Field label={t('library.nameEn')}>
              {({ id }) => (
                <Input id={id} value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
              )}
            </Field>

            <Segmented
              label={t('library.category')}
              value={category}
              onChange={setCategory}
              options={CATEGORIES.map((value) => ({ value, label: t(`categories.${value}`) }))}
            />

            {/* The set kind decides what the numbers MEAN. Twenty treadmill minutes stored as
                reps is the prototype's silent zero-volume bug, and it starts here. */}
            <Segmented
              label={t('library.setKind')}
              value={setKind}
              onChange={setSetKind}
              options={SET_KINDS.map((value) => ({ value, label: t(`setKinds.${value}`) }))}
            />

            <Button
              variant="primary"
              block
              icon="plus"
              loading={createExercise.isPending}
              onClick={() => void create()}
            >
              {t('picker.create')}
            </Button>
          </div>
        ) : null}
      </div>
    </Sheet>
  )
}
