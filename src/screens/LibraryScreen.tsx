import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { newId } from '@/data/ids'
import { useArchiveExercise, useCreateExercise, useExercises } from '@/data/hooks'
import { matches } from '@/domain/text'
import { currentLocale } from '@/i18n'
import type { Locale } from '@/domain/format'
import type {
  Equipment,
  Exercise,
  ExerciseCategory,
  SetKind,
  Uuid,
} from '@/domain/types'
import {
  Button,
  Card,
  CategoryPill,
  Chip,
  EmptyState,
  Field,
  Icon,
  Input,
  Screen,
  Sheet,
  Spinner,
} from '@/ui'

/**
 * The exercise catalogue.
 *
 * Two things about it are load-bearing rather than cosmetic.
 *
 * **The Greek name is the required one.** The prototype's "add exercise" wrote only `nameEn`,
 * so every movement a trainer added was English-only forever in a Greek UI — and there is no
 * edit path in the schema to go back and fix it. Here `nameEl` is what the form asks for first
 * and refuses to save without; English is the courtesy field underneath it.
 *
 * **Archive, never delete.** Three months of blocks point at these rows. A tombstone would
 * leave a coach reading a session that names an exercise nothing can resolve, so the only
 * destructive action here removes the row from this list and the picker and leaves history
 * exactly as it was. The shared catalogue (`gymId === null`) is not this gym's to touch at all
 * — the screen says which rows are which rather than letting a refusal look like a bug.
 */

const CATEGORIES: readonly ExerciseCategory[] = ['upper', 'lower', 'core', 'cardio', 'mobility']

const EQUIPMENT: readonly Equipment[] = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'bodyweight',
  'cardio',
  'kettlebell',
  'other',
]

const SET_KINDS: readonly SetKind[] = ['weight_reps', 'bodyweight', 'duration', 'distance']

const ALL = 'all'
type CategoryFilter = ExerciseCategory | typeof ALL
type EquipmentFilter = Equipment | typeof ALL

const headerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 12,
}

const titleStyle: CSSProperties = { fontSize: 'var(--th-text-2xl)', margin: 0 }

const searchWrap: CSSProperties = { position: 'relative', display: 'flex' }

const searchIcon: CSSProperties = {
  position: 'absolute',
  left: 13,
  top: '50%',
  transform: 'translateY(-50%)',
  color: 'var(--th-faint)',
  pointerEvents: 'none',
  display: 'flex',
}

const chipRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }

const filterStack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }

const metaLine: CSSProperties = {
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  margin: 0,
}

const rowInner: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  textAlign: 'left',
}

const nameCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
  flex: '1 1 auto',
}

const nameStyle: CSSProperties = {
  fontSize: 'var(--th-text-md)',
  fontWeight: 600,
  color: 'var(--th-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const subStyle: CSSProperties = {
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const listStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }

const detailRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  fontSize: 'var(--th-text-sm)',
}

const dangerZone: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  marginTop: 6,
  paddingTop: 'var(--th-pad)',
  borderTop: '1px solid var(--th-line-soft)',
}

const bodyText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-ink)',
  lineHeight: 1.45,
}

/** A named result of an action, good or bad. Never a bare "Error". */
function Notice({ text, tone }: { text: string; tone: 'ok' | 'bad' }) {
  return (
    <p
      role="status"
      style={{
        margin: 0,
        fontSize: 'var(--th-text-sm)',
        lineHeight: 1.45,
        color: tone === 'bad' ? 'var(--th-danger)' : 'var(--th-success)',
      }}
    >
      {text}
    </p>
  )
}

/**
 * Which name leads. Greek leads in the Greek UI even when an English name exists, because the
 * gym talks in Greek; the other language stays underneath rather than disappearing, so a coach
 * searching in either finds the row and recognises it.
 */
function names(exercise: Exercise, locale: Locale): { primary: string; secondary: string | null } {
  const el = exercise.nameEl?.trim() || null
  const en = exercise.nameEn?.trim() || null
  const [first, second] = locale === 'el' ? [el, en] : [en, el]
  const primary = first ?? second ?? ''
  const secondary = first && second ? second : null
  return { primary, secondary }
}

export function LibraryScreen() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const catalogue = useExercises()
  const create = useCreateExercise()
  const archive = useArchiveExercise()

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<CategoryFilter>(ALL)
  const [equipment, setEquipment] = useState<EquipmentFilter>(ALL)
  const [withArchived, setWithArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<Uuid | null>(null)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null)

  const all = catalogue.data ?? []

  /**
   * Filtered on every render rather than memoised on the array's identity. The local
   * repository hands out live row references and edits them in place, so archiving one leaves
   * the array — and therefore a `useMemo` keyed on it — unchanged while the row inside it has
   * changed. The memo would keep the archived exercise on screen until something else moved.
   * Thirty rows is not worth a cache that can be wrong.
   */
  const visible = all.filter((exercise) => {
    if (exercise.isArchived && !withArchived) return false
    if (category !== ALL && exercise.category !== category) return false
    if (equipment !== ALL && exercise.equipment !== equipment) return false
    if (search.trim() === '') return true
    // Both names, so a coach who only knows "Bench press" finds "Πιέσεις Στήθους".
    return matches(`${exercise.nameEl ?? ''} ${exercise.nameEn ?? ''}`, search)
  })

  const open = openId ? (all.find((exercise) => exercise.id === openId) ?? null) : null

  const header = (
    <>
      <div style={headerRow}>
        <h1 className="display" style={titleStyle}>
          {t('library.title')}
        </h1>
        <Button
          variant="primary"
          icon="plus"
          onClick={() => {
            setNotice(null)
            setCreating(true)
          }}
        >
          {t('library.add')}
        </Button>
      </div>

      <div style={searchWrap}>
        <span style={searchIcon} aria-hidden="true">
          <Icon name="search" size={18} />
        </span>
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('library.searchPlaceholder')}
          aria-label={t('library.searchPlaceholder')}
          style={{ paddingLeft: 40 }}
        />
      </div>
    </>
  )

  return (
    <Screen label={t('library.title')} header={header} footerSafeArea={false}>
      <div style={filterStack}>
        <div style={chipRow} role="group" aria-label={t('library.category')}>
          <Chip selected={category === ALL} onClick={() => setCategory(ALL)}>
            {t('common.filterAll')}
          </Chip>
          {CATEGORIES.map((value) => (
            <Chip
              key={value}
              selected={category === value}
              onClick={() => setCategory(category === value ? ALL : value)}
            >
              {t(`categories.${value}`)}
            </Chip>
          ))}
        </div>

        <div style={chipRow} role="group" aria-label={t('library.equipment')}>
          <Chip selected={equipment === ALL} onClick={() => setEquipment(ALL)}>
            {t('library.allEquipment')}
          </Chip>
          {EQUIPMENT.map((value) => (
            <Chip
              key={value}
              selected={equipment === value}
              onClick={() => setEquipment(equipment === value ? ALL : value)}
            >
              {t(`equipmentTypes.${value}`)}
            </Chip>
          ))}
        </div>

        <div style={chipRow}>
          <Chip
            icon={withArchived ? 'check' : 'library'}
            selected={withArchived}
            onClick={() => setWithArchived((previous) => !previous)}
          >
            {t('library.showArchived')}
          </Chip>
        </div>
      </div>

      {notice ? <Notice text={notice.text} tone={notice.tone} /> : null}

      {catalogue.isPending ? (
        <Spinner label={t('common.loading')} />
      ) : catalogue.isError ? (
        <EmptyState
          icon="alert"
          title={t('library.loadFailed')}
          description={t('errors.genericBody')}
          action={
            <Button variant="secondary" icon="undo" onClick={() => void catalogue.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="library"
          title={all.length === 0 ? t('library.empty') : t('library.noMatches')}
          description={all.length === 0 ? t('library.emptyHint') : t('library.noMatchesHint')}
          action={
            all.length === 0 ? (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                {t('library.add')}
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <p style={metaLine}>{t('counts.exercise', { count: visible.length })}</p>
          <div style={listStyle}>
            {visible.map((exercise) => {
              const { primary, secondary } = names(exercise, locale)
              const own = exercise.gymId !== null
              return (
                <Card
                  key={exercise.id}
                  onClick={() => {
                    setNotice(null)
                    setOpenId(exercise.id)
                  }}
                  ariaLabel={primary}
                >
                  <span style={rowInner}>
                    <CategoryPill category={exercise.category} dotOnly />
                    <span style={nameCol}>
                      <span style={nameStyle}>{primary}</span>
                      <span style={subStyle}>
                        {[
                          secondary,
                          t(`equipmentTypes.${exercise.equipment}`),
                          own ? t('library.own') : t('library.shared'),
                          exercise.isArchived ? t('library.archived') : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <Icon name="chevron" size={18} />
                  </span>
                </Card>
              )
            })}
          </div>
        </>
      )}

      <CreateExerciseSheet
        open={creating}
        onClose={() => setCreating(false)}
        busy={create.isPending}
        onCreate={async (input) => {
          const state = await create.mutateAsync(input)
          if (state === 'failed') return false
          setCreating(false)
          setNotice({
            text: state === 'queued' ? t('common.queued') : t('library.createDone'),
            tone: 'ok',
          })
          return true
        }}
      />

      <ExerciseSheet
        exercise={open}
        locale={locale}
        busy={archive.isPending}
        onClose={() => setOpenId(null)}
        onArchive={async (exerciseId) => {
          const state = await archive.mutateAsync(exerciseId)
          setOpenId(null)
          setNotice(
            state === 'failed'
              ? { text: t('library.archiveFailed'), tone: 'bad' }
              : {
                  text: state === 'queued' ? t('common.queued') : t('library.archiveDone'),
                  tone: 'ok',
                },
          )
        }}
      />
    </Screen>
  )
}

// ---------------------------------------------------------------------------
// New exercise
// ---------------------------------------------------------------------------

interface CreateExerciseSheetProps {
  open: boolean
  onClose: () => void
  busy: boolean
  /** Resolves false when the write was refused, so the sheet stays open with the typed name. */
  onCreate: (input: {
    id: Uuid
    nameEl: string
    nameEn: string | null
    category: ExerciseCategory
    equipment: Equipment
    defaultSetKind: SetKind
  }) => Promise<boolean>
}

function CreateExerciseSheet({ open, onClose, busy, onCreate }: CreateExerciseSheetProps) {
  const { t } = useTranslation()
  const [nameEl, setNameEl] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [category, setCategory] = useState<ExerciseCategory>('upper')
  const [equipment, setEquipment] = useState<Equipment>('barbell')
  const [setKind, setSetKind] = useState<SetKind>('weight_reps')
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setNameEl('')
    setNameEn('')
    setCategory('upper')
    setEquipment('barbell')
    setSetKind('weight_reps')
    setError(null)
  }

  async function submit() {
    const el = nameEl.trim()
    if (el === '') {
      setError(t('library.nameElRequired'))
      return
    }
    const created = await onCreate({
      id: newId(),
      nameEl: el,
      nameEn: nameEn.trim() === '' ? null : nameEn.trim(),
      category,
      equipment,
      defaultSetKind: setKind,
    })
    if (!created) {
      setError(t('library.createFailed'))
      return
    }
    reset()
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title={t('library.createTitle')}
      footer={
        <Button variant="primary" block loading={busy} disabled={busy} onClick={() => void submit()}>
          {t('library.createSubmit')}
        </Button>
      }
    >
      {/* Greek first and required: the prototype asked for English and left every
          trainer-added movement unreadable in the UI the gym actually uses. */}
      <Field label={t('library.nameEl')} required error={error ?? undefined}>
        <Input
          value={nameEl}
          onChange={(event) => {
            setNameEl(event.target.value)
            if (error) setError(null)
          }}
          autoComplete="off"
        />
      </Field>

      <Field label={t('library.nameEn')} hint={t('common.optional')}>
        <Input value={nameEn} onChange={(event) => setNameEn(event.target.value)} autoComplete="off" />
      </Field>

      <Field label={t('library.category')}>
        {() => (
          <div style={chipRow}>
            {CATEGORIES.map((value) => (
              <Chip key={value} selected={category === value} onClick={() => setCategory(value)}>
                {t(`categories.${value}`)}
              </Chip>
            ))}
          </div>
        )}
      </Field>

      <Field label={t('library.equipment')}>
        {() => (
          <div style={chipRow}>
            {EQUIPMENT.map((value) => (
              <Chip key={value} selected={equipment === value} onClick={() => setEquipment(value)}>
                {t(`equipmentTypes.${value}`)}
              </Chip>
            ))}
          </div>
        )}
      </Field>

      {/* A treadmill logged as weight×reps totals as zero volume forever. The kind is chosen
          once, here, because nothing downstream can infer it from a number. */}
      <Field label={t('library.setKind')}>
        {() => (
          <div style={chipRow}>
            {SET_KINDS.map((value) => (
              <Chip key={value} selected={setKind === value} onClick={() => setSetKind(value)}>
                {t(`setKinds.${value}`)}
              </Chip>
            ))}
          </div>
        )}
      </Field>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// One exercise
// ---------------------------------------------------------------------------

interface ExerciseSheetProps {
  exercise: Exercise | null
  locale: Locale
  busy: boolean
  onClose: () => void
  onArchive: (exerciseId: Uuid) => Promise<void>
}

function ExerciseSheet({ exercise, locale, busy, onClose, onArchive }: ExerciseSheetProps) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)

  if (!exercise) return null
  const { primary, secondary } = names(exercise, locale)
  const own = exercise.gymId !== null

  return (
    <Sheet
      open
      onClose={() => {
        setConfirming(false)
        onClose()
      }}
      title={primary}
    >
      {secondary ? <p style={{ ...metaLine, marginTop: -4 }}>{secondary}</p> : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={detailRow}>
          <span style={{ color: 'var(--th-muted)' }}>{t('library.category')}</span>
          <CategoryPill category={exercise.category} />
        </div>
        <div style={detailRow}>
          <span style={{ color: 'var(--th-muted)' }}>{t('library.equipment')}</span>
          <span>{t(`equipmentTypes.${exercise.equipment}`)}</span>
        </div>
        <div style={detailRow}>
          <span style={{ color: 'var(--th-muted)' }}>{t('library.setKind')}</span>
          <span>{t(`setKinds.${exercise.defaultSetKind}`)}</span>
        </div>
        <div style={detailRow}>
          <span style={{ color: 'var(--th-muted)' }}>{t('library.defaultRest')}</span>
          <span>{t('library.restSeconds', { seconds: exercise.defaultRestS })}</span>
        </div>
        <div style={detailRow}>
          <span style={{ color: 'var(--th-muted)' }}>{t('library.source')}</span>
          <span>{own ? t('library.own') : t('library.shared')}</span>
        </div>
      </div>

      {exercise.isArchived ? (
        <p style={bodyText}>
          {t('library.archived')} · {t('library.archiveOneWay')}
        </p>
      ) : !own ? (
        <p style={bodyText}>{t('library.sharedLocked')}</p>
      ) : (
        <div style={dangerZone}>
          <p style={bodyText}>{t('library.archiveHint')}</p>
          {confirming ? (
            <>
              <p style={bodyText}>
                <strong>{t('library.archiveConfirm')}</strong> {t('library.archiveOneWay')}
              </p>
              <Button
                variant="danger"
                block
                icon="library"
                loading={busy}
                disabled={busy}
                onClick={() => {
                  setConfirming(false)
                  void onArchive(exercise.id)
                }}
              >
                {t('library.archiveAction')}
              </Button>
              <Button variant="quiet" block onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <Button variant="dangerQuiet" block icon="library" onClick={() => setConfirming(true)}>
              {t('library.archiveAction')}
            </Button>
          )}
        </div>
      )}
    </Sheet>
  )
}
