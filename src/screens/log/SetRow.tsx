import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { formatSet, formatWeight, type Locale } from '@/domain/format'
import type { SetKind, WorkoutSet } from '@/domain/types'
import { SwipeRow } from '@/ui'

/**
 * One logged set: 64px tall, tabular numerals, every number a tap target.
 *
 * The row is the only place a coach touches while the athlete is still under the bar, so it
 * carries no chrome — an ordinal, the numbers, and (when it exists) the RPE. Tapping a number
 * opens the Keypad on THAT field: the correction a trainer actually makes mid-session is "it
 * was nine reps, not eight", and making them re-enter the load to fix the reps is how a
 * correction gets skipped and the sheet quietly goes wrong.
 *
 * Delete is a swipe with an undo toast, never a confirm — see `SwipeRow` and `useToast`.
 */

/** Which column of a set a keypad entry lands in. */
export type SetField = 'load' | 'reps' | 'seconds' | 'meters'

/** The field a tap on the row opens when the numbers are not split into their own targets. */
export const PRIMARY_FIELD: Record<SetKind, SetField> = {
  weight_reps: 'load',
  bodyweight: 'reps',
  duration: 'seconds',
  distance: 'meters',
}

/**
 * What a NEW set of each kind asks for, in order. The pad walks this list and writes the row
 * once the last field is committed, so "80 → 8 → done" is one uninterrupted thumb movement.
 */
export const FIELD_SEQUENCE: Record<SetKind, readonly SetField[]> = {
  weight_reps: ['load', 'reps'],
  bodyweight: ['reps'],
  duration: ['seconds'],
  distance: ['meters'],
}

/** The value already on a set for one field, for prefilling a chip or an edit. */
export function fieldValue(set: WorkoutSet, field: SetField): number | null {
  switch (field) {
    case 'load':
      return set.loadKg
    case 'reps':
      return set.reps
    case 'seconds':
      return set.seconds
    case 'meters':
      return set.meters
  }
}

interface Segment {
  text: string
  /** Absent on a separator, which is not a target. */
  field?: SetField
}

/**
 * The row's numbers, split so each one can be tapped on its own.
 *
 * A weight×reps set is the only kind with two independently wrong numbers, so it is the only
 * one split. The concatenation is byte-identical to `formatSet` — there is a test that says so
 * — because two renderings of the same set that drift apart is exactly how "80×8" ends up
 * meaning something different in two places in this app.
 */
function segments(set: WorkoutSet, locale: Locale): Segment[] {
  const hasLoad = set.loadKg !== null && Number.isFinite(set.loadKg)
  const hasReps = set.reps !== null && Number.isFinite(set.reps)

  if (set.kind === 'weight_reps' && hasLoad && hasReps) {
    return [
      { text: formatWeight(set.loadKg, locale), field: 'load' },
      { text: '×' },
      { text: String(set.reps), field: 'reps' },
    ]
  }
  return [{ text: formatSet(set, set.kind, locale), field: PRIMARY_FIELD[set.kind] }]
}

export interface SetRowProps {
  set: WorkoutSet
  /** 1-based, as the coach counts them. */
  index: number
  /** For the delete button's accessible name and the keypad's title. */
  exerciseName: string
  locale: Locale
  onEdit: (field: SetField) => void
  onDelete: () => void
}

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  height: 64,
  paddingLeft: 14,
  paddingRight: 14,
  background: 'var(--th-surface-2)',
  borderRadius: 'var(--th-r-sm)',
}

const ordinal: CSSProperties = {
  flex: '0 0 auto',
  minWidth: 22,
  fontSize: 'var(--th-text-sm)',
  fontWeight: 700,
  color: 'var(--th-faint)',
}

const valueButton: CSSProperties = {
  // 44px inside a 64px row: the target is the full height of the row it sits in, so a thumb
  // aimed anywhere near the number lands on it.
  minHeight: 44,
  minWidth: 44,
  padding: '0 8px',
  borderRadius: 'var(--th-r-xs)',
  background: 'transparent',
  color: 'var(--th-ink)',
  fontSize: 'var(--th-text-lg)',
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const separator: CSSProperties = {
  fontSize: 'var(--th-text-lg)',
  fontWeight: 600,
  color: 'var(--th-muted)',
}

const rpeBadge: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 'var(--th-text-xs)',
  fontWeight: 700,
  letterSpacing: 'var(--th-label-tracking)',
  color: 'var(--th-muted)',
}

export function SetRow({ set, index, exerciseName, locale, onEdit, onDelete }: SetRowProps) {
  const { t } = useTranslation()
  const label = `${t('log.setNumber', { number: index })} — ${exerciseName}`

  return (
    <SwipeRow onDelete={onDelete} deleteLabel={t('common.delete')} itemLabel={label}>
      <div style={row}>
        <span className="num" style={ordinal}>
          {index}
        </span>

        {segments(set, locale).map((segment, i) =>
          segment.field ? (
            <button
              key={`${segment.field}-${i}`}
              type="button"
              className="th-tap num"
              style={valueButton}
              onClick={() => onEdit(segment.field as SetField)}
              aria-label={`${t(`log.${fieldKey(segment.field)}`)} — ${label}`}
            >
              {segment.text}
            </button>
          ) : (
            <span key={`sep-${i}`} className="num" style={separator} aria-hidden="true">
              {segment.text}
            </span>
          ),
        )}

        {set.rpe !== null && Number.isFinite(set.rpe) ? (
          <span className="num" style={rpeBadge}>
            {t('log.rpe')} {set.rpe}
          </span>
        ) : null}
      </div>
    </SwipeRow>
  )
}

/** The i18n leaf that names a field on screen. `load` is "Κιλά", not "load". */
export function fieldKey(field: SetField): 'kg' | 'reps' | 'seconds' | 'meters' {
  return field === 'load' ? 'kg' : field
}
