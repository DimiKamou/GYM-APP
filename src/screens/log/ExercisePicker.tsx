import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { useGymId } from '@/auth/useAuth'
import { newId } from '@/data/ids'
import { keys } from '@/data/keys'
import {
  useCreateExercise,
  useExercises,
  useMuscleGroups,
  useRecentExercises,
  useSetExerciseMuscles,
} from '@/data/hooks'
import type { ExerciseMuscleInput, Repo } from '@/data/repo/types'
import { useRepo } from '@/data/repo/useRepo'
import type { Locale } from '@/domain/format'
import { matches } from '@/domain/text'
import type {
  Exercise,
  ExerciseCategory,
  ExerciseMuscle,
  MuscleGroup,
  MuscleRole,
  SetKind,
  Uuid,
} from '@/domain/types'
import { Button, CategoryPill, Field, Input, Segmented, Sheet } from '@/ui'
import { MuscleChip, muscleGroupName } from '@/ui/MuscleChip'

/**
 * The exercise picker.
 *
 * Three decisions carry it, and the first two are corrections of the prototype:
 *
 *  - **It opens on this athlete's recent eight**, as full-width rows one tap each. Personal
 *    training is repetitive; the movement the coach wants is almost always one they did with
 *    this athlete last week, and a search box is three seconds and a spelling. Grouping the
 *    catalogue below does not move them: the recent strip is exactly why the taxonomy costs
 *    the common path nothing.
 *  - **It is NEVER pre-filtered by the block's current category.** The prototype filtered the
 *    list to the category of the exercise already in the block, which is a hidden dead end: a
 *    coach looking for "Έλξεις" in a "lower" block sees nothing, concludes it is missing, and
 *    creates a duplicate — and from then on the athlete's chart for that movement is forked
 *    across two rows that no report will ever add back together. The muscle-group chips are a
 *    filter the coach turns on, never one they find already on.
 *  - **The grouped catalogue lists a movement under every group it trains.** A bench press is
 *    under Στήθος and under Τρικέφαλοι. That is the point of the many-to-many, not a duplicate:
 *    a coach scanning Στήθος must see every chest movement the gym owns, and a hole in that
 *    list reads as "we do not have one". For the same reason the catalogue no longer subtracts
 *    what the recent strip is already showing, which it did while the list below was one flat
 *    "Όλες οι ασκήσεις": with headings, the list is a map of the taxonomy rather than a
 *    continuation of the strip, and a movement missing from Στήθος because the coach happened
 *    to use it last week is exactly the dead end that gets a duplicate created.
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

// ---------------------------------------------------------------------------
// The taxonomy, joined to the catalogue
// ---------------------------------------------------------------------------

/**
 * Reading the links is a capability, not a `Repo` method, in the same shape as
 * `ExerciseUnarchiver` in `useExercises.ts`: a repository that can answer says so by having
 * the function, and one that cannot leaves every exercise in the "χωρίς μυϊκή ομάδα" bucket
 * rather than crashing a live session over a taxonomy the coach did not ask for.
 */
interface ExerciseMuscleReader {
  listExerciseMuscles(gymId: Uuid): Promise<ExerciseMuscle[]>
}

function muscleReaderOf(repo: Repo): ExerciseMuscleReader | null {
  const candidate = repo as Repo & Partial<ExerciseMuscleReader>
  return typeof candidate.listExerciseMuscles === 'function'
    ? (candidate as ExerciseMuscleReader)
    : null
}

/**
 * Every visible exercise↔muscle link.
 *
 * Keyed under `keys.exercises(gymId)` on purpose: `invalidateCatalogue` already throws that
 * whole subtree away, so filing an exercise from this sheet refreshes the grouping in the same
 * breath as the catalogue. A picker whose headings disagree with its rows is worse than no
 * headings at all.
 */
export function useExerciseMuscles(): UseQueryResult<ExerciseMuscle[]> {
  const gymId = useGymId()
  const repo = useRepo()
  return useQuery({
    queryKey: [...keys.exercises(gymId), 'exercise-muscles'],
    queryFn: () => muscleReaderOf(repo)?.listExerciseMuscles(gymId) ?? Promise.resolve([]),
    staleTime: 10 * 60_000,
  })
}

/** One heading in the grouped catalogue. `group: null` is the unclassified bucket. */
export interface MuscleSection {
  group: MuscleGroup | null
  exercises: Exercise[]
}

export interface MuscleIndex {
  groups: MuscleGroup[]
  /** exerciseId → the groups it trains, primaries first. */
  byExercise: Map<Uuid, Array<{ group: MuscleGroup; role: MuscleRole }>>
  isPending: boolean
  isError: boolean
}

/**
 * The taxonomy and the join, in one hook, so the picker and the Library cannot end up drawing
 * two different versions of the same sheet.
 */
export function useMuscleIndex(): MuscleIndex {
  const groupsQuery = useMuscleGroups()
  const linksQuery = useExerciseMuscles()

  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data])
  const links = useMemo(() => linksQuery.data ?? [], [linksQuery.data])

  const byExercise = useMemo(() => {
    const byId = new Map(groups.map((group) => [group.id, group]))
    const index = new Map<Uuid, Array<{ group: MuscleGroup; role: MuscleRole }>>()
    for (const link of links) {
      const group = byId.get(link.muscleGroupId)
      // A link to a group this gym cannot see (or one that has been archived) falls through to
      // the unclassified bucket rather than being rendered as a heading nobody can read.
      if (!group) continue
      const list = index.get(link.exerciseId)
      if (list) list.push({ group, role: link.role })
      else index.set(link.exerciseId, [{ group, role: link.role }])
    }
    for (const list of index.values()) {
      // Primaries first, then the taxonomy's own display order — never alphabetical, or Στήθος
      // sorts under Τρικέφαλοι and no coach's mental model survives it.
      list.sort(
        (a, b) =>
          Number(b.role === 'primary') - Number(a.role === 'primary') ||
          a.group.position - b.group.position,
      )
    }
    return index
  }, [groups, links])

  return {
    groups,
    byExercise,
    isPending: groupsQuery.isPending || linksQuery.isPending,
    isError: groupsQuery.isError || linksQuery.isError,
  }
}

/**
 * The catalogue, folded under muscle-group headings in taxonomy order.
 *
 * An exercise appears under EVERY group it trains. Empty groups are dropped — a heading with
 * nothing under it is the same dead end the category pre-filter used to be — and everything
 * that is filed nowhere lands in the trailing `group: null` section, which is never silently
 * hidden because that bucket is precisely what a trainer is meant to come here and fix.
 */
export function groupByMuscle(
  exercises: readonly Exercise[],
  index: MuscleIndex,
): MuscleSection[] {
  const sections: MuscleSection[] = []
  const filed = new Set<Uuid>()

  for (const group of index.groups) {
    const inGroup: Exercise[] = []
    for (const exercise of exercises) {
      const link = index.byExercise.get(exercise.id)?.find((entry) => entry.group.id === group.id)
      if (!link) continue
      filed.add(exercise.id)
      inGroup.push(exercise)
    }
    if (inGroup.length === 0) continue
    // Within a heading, what the movement trains DIRECTLY comes first: a coach opening Στήθος
    // wants the presses above the dips that merely involve the chest.
    inGroup.sort((a, b) => Number(roleIn(index, b, group)) - Number(roleIn(index, a, group)))
    sections.push({ group, exercises: inGroup })
  }

  const rest = exercises.filter((exercise) => !filed.has(exercise.id))
  if (rest.length > 0) sections.push({ group: null, exercises: rest })
  return sections
}

function roleIn(index: MuscleIndex, exercise: Exercise, group: MuscleGroup): boolean {
  return (
    index.byExercise.get(exercise.id)?.some(
      (entry) => entry.group.id === group.id && entry.role === 'primary',
    ) ?? false
  )
}

/** none → primary → secondary → none. One control, three states, no hidden gesture. */
export function cycleRole(current: MuscleRole | null): MuscleRole | null {
  if (current === null) return 'primary'
  if (current === 'primary') return 'secondary'
  return null
}

export function withRole(
  links: readonly ExerciseMuscleInput[],
  muscleGroupId: Uuid,
  role: MuscleRole | null,
): ExerciseMuscleInput[] {
  const rest = links.filter((link) => link.muscleGroupId !== muscleGroupId)
  return role === null ? rest : [...rest, { muscleGroupId, role }]
}

// ---------------------------------------------------------------------------
// The chip grid, shared by "file this exercise" and "create one"
// ---------------------------------------------------------------------------

export interface MuscleGroupChoiceProps {
  groups: readonly MuscleGroup[]
  locale: Locale
  value: readonly ExerciseMuscleInput[]
  onChange: (next: ExerciseMuscleInput[]) => void
}

/** Every group, cycling none → primary → secondary. Wrapped, not scrolled: this one is a form. */
export function MuscleGroupChoice({ groups, locale, value, onChange }: MuscleGroupChoiceProps) {
  const { t } = useTranslation()
  const roleFor = (groupId: Uuid) =>
    value.find((link) => link.muscleGroupId === groupId)?.role ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={chipWrap} role="group" aria-label={t('muscles.group')}>
        {groups.map((group) => (
          <MuscleChip
            key={group.id}
            group={group}
            locale={locale}
            role={roleFor(group.id)}
            onClick={() => onChange(withRole(value, group.id, cycleRole(roleFor(group.id))))}
          />
        ))}
      </div>
      <p style={hintText}>{t('muscles.roleHint')}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------

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

const rowWrap: CSSProperties = { display: 'flex', alignItems: 'stretch', gap: 6 }

const fileButtonStyle: CSSProperties = {
  minHeight: 56,
  minWidth: 44,
  padding: '0 12px',
  borderRadius: 'var(--th-r-sm)',
  border: '1px dashed var(--th-line)',
  background: 'transparent',
  color: 'var(--th-muted)',
  fontSize: 'var(--th-text-xs)',
  fontWeight: 700,
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  flex: '0 0 auto',
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

const hintText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-xs)',
  color: 'var(--th-muted)',
  lineHeight: 1.4,
}

const chipWrap: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }

/**
 * The filter chips scroll sideways rather than wrapping: sixteen wrapped chips are four rows
 * of taxonomy between the recent strip and the catalogue, which is exactly the shove the
 * recent eight are here to avoid.
 */
const chipScroller: CSSProperties = {
  display: 'flex',
  gap: 8,
  overflowX: 'auto',
  paddingBottom: 2,
  // The chips are the scroll container's only children, so they must not be squeezed to fit.
  flexWrap: 'nowrap',
}

const filingPanel: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 'var(--th-pad)',
  borderRadius: 'var(--th-r-sm)',
  background: 'var(--th-surface-2)',
  border: '1px solid var(--th-line-soft)',
}

export function ExercisePicker({ open, onClose, athleteId, locale, onSelect }: ExercisePickerProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [nameEn, setNameEn] = useState('')
  /** Null means "the coach has not overridden it", so the chosen group's region can lead. */
  const [categoryOverride, setCategoryOverride] = useState<ExerciseCategory | null>(null)
  const [setKind, setSetKind] = useState<SetKind>('weight_reps')
  const [activeGroupId, setActiveGroupId] = useState<Uuid | null>(null)
  const [createLinks, setCreateLinks] = useState<ExerciseMuscleInput[] | null>(null)
  const [filingId, setFilingId] = useState<Uuid | null>(null)
  const [filingLinks, setFilingLinks] = useState<ExerciseMuscleInput[]>([])
  const [filingError, setFilingError] = useState<string | null>(null)

  const exercises = useExercises()
  const recent = useRecentExercises(athleteId, 8)
  const createExercise = useCreateExercise()
  const setExerciseMuscles = useSetExerciseMuscles()
  const index = useMuscleIndex()

  const catalogue = useMemo(
    () => (exercises.data ?? []).filter((exercise) => !exercise.isArchived),
    [exercises.data],
  )

  const hit = (exercise: Exercise) =>
    matches(exercise.nameEl ?? '', query) || matches(exercise.nameEn ?? '', query)

  const inActiveGroup = (exercise: Exercise) =>
    activeGroupId === null ||
    (index.byExercise.get(exercise.id)?.some((entry) => entry.group.id === activeGroupId) ?? false)

  const searched = catalogue.filter(hit)
  const shown = searched.filter(inActiveGroup)
  const recentHits = (recent.data ?? []).filter(
    (entry) => hit(entry.exercise) && inActiveGroup(entry.exercise),
  )

  /**
   * The chip counts are computed over what the SEARCH has already left standing, so a chip
   * never promises rows that tapping it cannot produce. A group the search has emptied is
   * dropped entirely — except the one currently on, which has to stay reachable to be turned
   * off again.
   */
  const chips = index.groups
    .map((group) => ({
      group,
      count: searched.filter(
        (exercise) =>
          index.byExercise.get(exercise.id)?.some((entry) => entry.group.id === group.id) ?? false,
      ).length,
    }))
    .filter(({ group, count }) => count > 0 || group.id === activeGroupId)

  const grouped = activeGroupId === null && query.trim() === ''
  const sections = grouped ? groupByMuscle(shown, index) : []
  const activeGroup = index.groups.find((group) => group.id === activeGroupId) ?? null

  const nothingFound = recentHits.length === 0 && shown.length === 0

  // The category the new exercise gets: the chosen group's region unless the coach said
  // otherwise. Filing "Πιέσεις σε μηχάνημα" under Στήθος already answers "upper".
  const effectiveCreateLinks =
    createLinks ??
    (activeGroupId !== null
      ? [{ muscleGroupId: activeGroupId, role: 'primary' as MuscleRole }]
      : [])
  const leadGroup = index.groups.find(
    (group) => group.id === effectiveCreateLinks.find((link) => link.role === 'primary')?.muscleGroupId,
  )
  const category = categoryOverride ?? leadGroup?.region ?? 'upper'

  function choose(exerciseId: Uuid) {
    reset()
    onSelect(exerciseId)
  }

  function reset() {
    setQuery('')
    setNameEn('')
    setCategoryOverride(null)
    setActiveGroupId(null)
    setCreateLinks(null)
    closeFiling()
  }

  function closeFiling() {
    setFilingId(null)
    setFilingLinks([])
    setFilingError(null)
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
    // which on the local repository is instant and on a queued write may be hours. The muscle
    // links ride along in the same call: a second step, mid-session, is a second chance never
    // to classify the movement at all.
    await createExercise.mutateAsync({
      id,
      nameEl,
      nameEn: nameEn.trim() === '' ? null : nameEn.trim(),
      category,
      equipment: 'other',
      defaultSetKind: setKind,
      muscles: effectiveCreateLinks,
    })
    choose(id)
  }

  async function saveFiling(exerciseId: Uuid) {
    const state = await setExerciseMuscles.mutateAsync({ exerciseId, links: filingLinks })
    if (state === 'failed') {
      setFilingError(t('muscles.fileFailed'))
      return
    }
    closeFiling()
  }

  function row(exercise: Exercise, meta?: string) {
    // Only a gym's OWN exercise can be refiled, and only one that is filed nowhere is offered
    // the shortcut: the shared catalogue ships classified, and the Library is where a coach
    // rearranges a movement that already has a home.
    const filed = index.byExercise.get(exercise.id)?.length ?? 0
    const canFile = exercise.gymId !== null && filed === 0 && !index.isPending

    return (
      <div key={exercise.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={rowWrap}>
          <button
            type="button"
            className="th-tap"
            style={{ ...rowStyle, flex: '1 1 auto', minWidth: 0 }}
            onClick={() => choose(exercise.id)}
          >
            <CategoryPill category={exercise.category} dotOnly />
            <span>{exerciseName(exercise, locale)}</span>
            {meta ? <span style={metaText}>{meta}</span> : null}
          </button>

          {canFile ? (
            <button
              type="button"
              className="th-tap"
              style={fileButtonStyle}
              aria-expanded={filingId === exercise.id}
              aria-label={`${exerciseName(exercise, locale)} — ${t('muscles.file')}`}
              onClick={() => {
                setFilingError(null)
                if (filingId === exercise.id) {
                  closeFiling()
                  return
                }
                setFilingId(exercise.id)
                setFilingLinks(
                  activeGroupId !== null
                    ? [{ muscleGroupId: activeGroupId, role: 'primary' }]
                    : [],
                )
              }}
            >
              {t('muscles.file')}
            </button>
          ) : null}
        </div>

        {/* Expanded in place rather than in a second sheet: a modal on top of a modal steals
            the focus trap, and the coach is one tap from losing the exercise they just found. */}
        {filingId === exercise.id ? (
          <div style={filingPanel} data-testid="filing-panel">
            <p style={hintText}>{t('muscles.fileHint')}</p>
            <MuscleGroupChoice
              groups={index.groups}
              locale={locale}
              value={filingLinks}
              onChange={setFilingLinks}
            />
            {filingError ? (
              <p role="status" style={{ ...hintText, color: 'var(--th-danger)' }}>
                {filingError}
              </p>
            ) : null}
            <Button
              variant="primary"
              block
              icon="check"
              loading={setExerciseMuscles.isPending}
              disabled={filingLinks.length === 0 || setExerciseMuscles.isPending}
              onClick={() => void saveFiling(exercise.id)}
            >
              {t('common.save')}
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

  /**
   * A heading and its rows. `display: contents` keeps the wrapper out of the layout while
   * giving the section a single element to hang a name off — which is what lets the tests ask
   * "is Πιέσεις Στήθους under Στήθος" rather than "does the sheet contain both strings".
   */
  function section(label: string, children: ReactNode, key?: string) {
    return (
      <div
        key={key}
        style={{ display: 'contents' }}
        data-testid="picker-section"
        data-section={key ?? label}
      >
        <p style={sectionLabel}>{label}</p>
        <div style={list}>{children}</div>
      </div>
    )
  }

  return (
    <Sheet open={open} onClose={close} title={t('picker.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* First, always, and unmoved by the taxonomy below it. A coach mid-session wants last
            week's lifts, not a classification scheme. */}
        {recentHits.length > 0
          ? section(
              t('picker.recent'),
              recentHits.map((entry) =>
                row(entry.exercise, t('counts.session', { count: entry.timesUsed })),
              ),
            )
          : null}

        {chips.length > 0 ? (
          <div style={chipScroller} role="group" aria-label={t('muscles.filter')}>
            {chips.map(({ group, count }) => (
              <MuscleChip
                key={group.id}
                group={group}
                locale={locale}
                selected={group.id === activeGroupId}
                count={count}
                onClick={() => {
                  closeFiling()
                  setActiveGroupId(group.id === activeGroupId ? null : group.id)
                }}
              />
            ))}
          </div>
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

        {index.isError ? <p style={hintText}>{t('muscles.loadFailed')}</p> : null}

        {grouped
          ? sections.map((entry) =>
              section(
                entry.group
                  ? muscleGroupName(entry.group, locale)
                  : t('muscles.unclassified'),
                entry.exercises.map((exercise) => row(exercise)),
                entry.group?.id ?? 'unclassified',
              ),
            )
          : shown.length > 0
            ? section(
                activeGroup ? muscleGroupName(activeGroup, locale) : t('picker.allExercises'),
                shown.map((exercise) => row(exercise)),
              )
            : null}

        {shown.length === 0 && activeGroup && query.trim() === '' ? (
          <p style={hintText}>{t('muscles.empty')}</p>
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

            {/* The owner's actual request, answered without leaving the session: the movement
                gets its μυϊκή ομάδα at the moment it is invented, which is the only moment
                anyone knows what it is. */}
            <Field label={t('muscles.group')} hint={t('muscles.createHint')}>
              {() => (
                <MuscleGroupChoice
                  groups={index.groups}
                  locale={locale}
                  value={effectiveCreateLinks}
                  onChange={setCreateLinks}
                />
              )}
            </Field>

            <Segmented
              label={t('library.category')}
              value={category}
              onChange={(value) => setCategoryOverride(value)}
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
