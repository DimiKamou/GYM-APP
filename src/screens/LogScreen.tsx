import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { newId } from '@/data/ids'
import {
  useAddBlock,
  useAddNote,
  useAddSet,
  useAthlete,
  useBriefing,
  useDeleteBlock,
  useExercises,
  useFinishSession,
  useLastPerformance,
  useSessionTree,
  useSetBlockExercise,
  useSetNotePinned,
  useTeam,
  useUndoableSetDelete,
  useUpdateSession,
  useUpdateSet,
  type SetPatch,
} from '@/data/hooks'
import { sessionSets, sessionVolume } from '@/domain/analytics'
import { formatDate, formatSet, formatWeight, type Locale } from '@/domain/format'
import type { LastPerformance, SetKind, Uuid, WorkoutSet } from '@/domain/types'
import { currentLocale } from '@/i18n'
import {
  Button,
  EmptyState,
  Keypad,
  Screen,
  Spinner,
  ToastProvider,
  useToast,
  type KeypadSuggestion,
} from '@/ui'
import { ExerciseBlock, blockSetKind } from '@/screens/log/ExerciseBlock'
import { ExercisePicker, exerciseName } from '@/screens/log/ExercisePicker'
import { FinishSheet, type FinishPayload } from '@/screens/log/FinishSheet'
import { RestBar } from '@/screens/log/RestBar'
import { SessionHeader } from '@/screens/log/SessionHeader'
import { FIELD_SEQUENCE, fieldKey, fieldValue, type SetField } from '@/screens/log/SetRow'

/**
 * The Workout Log — the screen the whole product is timed against.
 *
 * The premise, which decides everything below: a trainer is standing at a rack with one hand
 * on the phone, chalk on the other, counting an athlete's reps and talking to them. Recording
 * a set has to cost under eight seconds and no thought at all.
 *
 * What that buys, counted in taps:
 *   - the same set again — ONE tap ("Ίδιο με πριν"; it clones the previous row outright);
 *   - a new set — "Προσθήκη σετ", the digits, commit, the reps, commit: four taps plus the
 *     number, with no OS keyboard anywhere and no pad to dismiss afterwards, because
 *     committing the last field of the sequence writes the set and puts the pad away itself;
 *   - a correction — one tap on the wrong number, the digits, commit.
 *
 * Three things here are load-bearing rather than cosmetic:
 *   - **Every coaching number carries its date and author.** The last-time line and every
 *     keypad chip render "80×8 · 12 Αυγ · Μαρία". A coach loads a bar with these numbers.
 *   - **No `<input>` ever touches a number.** The Keypad exists because the Greek keyboard's
 *     decimal key emits a comma and `Number("72,5")` is `NaN` — a NaN that would reach storage
 *     and then every volume total and chart downstream.
 *   - **The screen is held awake while the session is active.** The largest real latency tax
 *     against paper is not typing: it is that the phone sleeps between sets, so every set
 *     costs an unlock first.
 */

/** Which column of a set each keypad field writes. */
function withValue(field: SetField, value: number): SetPatch {
  switch (field) {
    case 'load':
      return { loadKg: value }
    case 'reps':
      return { reps: value }
    case 'seconds':
      return { seconds: value }
    case 'meters':
      return { meters: value }
  }
}

type Draft = Pick<WorkoutSet, 'loadKg' | 'reps' | 'seconds' | 'meters'>

const EMPTY_DRAFT: Draft = { loadKg: null, reps: null, seconds: null, meters: null }

const DEFAULT_REST_S = 90

interface PadState {
  blockId: Uuid
  exerciseId: Uuid
  exerciseLabel: string
  kind: SetKind
  /** Null while composing a new set; set when correcting one already on the sheet. */
  setId: Uuid | null
  position: number
  field: SetField
  draft: Draft
  restS: number
}

interface PadConfig {
  unit?: string
  min: number
  max: number
  integer: boolean
  nudges: readonly [number, number]
}

/**
 * The pad's shape per field. The nudges are the plates and the counts a coach thinks in —
 * ±2,5 kg because that is the smallest pair on the rack, ±1 because reps are counted one by
 * one. The maxima are refusal thresholds, not clamps: see `parseDecimal`.
 */
function padConfig(field: SetField): PadConfig {
  switch (field) {
    case 'load':
      return { unit: 'kg', min: 0, max: 1000, integer: false, nudges: [2.5, 5] }
    case 'reps':
      return { min: 0, max: 999, integer: true, nudges: [1, 5] }
    case 'seconds':
      return { min: 0, max: 7200, integer: true, nudges: [10, 30] }
    case 'meters':
      return { min: 0, max: 100000, integer: true, nudges: [100, 500] }
  }
}

/** A number as the trainer reads it, for a suggestion chip. Its provenance travels with it. */
function chipLabel(field: SetField, value: number, kind: SetKind, locale: Locale): string {
  switch (field) {
    case 'load':
      return formatWeight(value, locale, { unit: true })
    case 'reps':
      return String(value)
    case 'seconds':
      return formatSet({ ...EMPTY_DRAFT, kind, seconds: value }, 'duration', locale)
    case 'meters':
      return formatSet({ ...EMPTY_DRAFT, kind, meters: value }, 'distance', locale)
  }
}

/** The one field of a previous performance the pad is currently asking for. */
function lastValueOf(last: LastPerformance, field: SetField): number | null {
  switch (field) {
    case 'load':
      return last.loadKg
    case 'reps':
      return last.reps
    case 'seconds':
      return last.seconds
    case 'meters':
      return last.meters
  }
}

/**
 * Holds the screen awake for as long as the session is active.
 *
 * Everything here is best effort and wrapped: `wakeLock` does not exist on iOS below 16.4 or
 * in Firefox, the request is rejected outright while the tab is hidden, and the browser drops
 * the lock every time the tab is backgrounded — hence the re-request on visibility. None of
 * that may surface as an error; the fallback is the phone behaving exactly as it always has.
 */
function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    async function acquire(): Promise<void> {
      try {
        if (sentinel !== null && !sentinel.released) return
        const next = await navigator.wakeLock.request('screen')
        if (cancelled) {
          void next.release()
          return
        }
        sentinel = next
      } catch {
        // Unsupported, denied, or the tab was hidden mid-request. The screen just sleeps.
      }
    }

    function onVisibility(): void {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      try {
        void sentinel?.release()
      } catch {
        // Already released by the browser. Nothing to clean up and nothing to report.
      }
    }
  }, [active])
}

/**
 * Appends the session RPE to the session's free text, replacing one already there.
 *
 * `sessions` has no `rpe` column — the schema puts RPE on a set, where a number that describes
 * one effort belongs — and adding one is a migration this screen does not own. Writing it as a
 * line of the session's own notes keeps it visible, exportable and honest, and stripping the
 * previous line first is what stops re-finishing from stacking "RPE 8 / RPE 8 / RPE 9".
 */
function withSessionRpe(notes: string | null, rpe: number): string {
  const body = (notes ?? '').replace(/\n?RPE \d+(?:[.,]\d+)?\s*$/u, '').trim()
  const line = `RPE ${rpe}`
  return body === '' ? line : `${body}\n${line}`
}

/**
 * The screen owns its own toast provider.
 *
 * Deleting a set is undoable rather than confirmed, and the undo lives in a toast — so this
 * screen cannot work without one. Mounting it here rather than assuming one higher up means
 * the guarantee is local: `useToast` throws when it is missing, and a white-screened Log is a
 * coach standing at a rack with nothing to write on. Nesting inside an app-wide provider, if
 * one is added later, is harmless — the nearest provider wins for this subtree.
 */
export function LogScreen() {
  return (
    <ToastProvider>
      <LogScreenBody />
    </ToastProvider>
  )
}

function LogScreenBody() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const { sessionId } = useParams<'sessionId'>()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()

  const tree = useSessionTree(sessionId)
  const session = tree.data ?? null
  const athleteId = session?.athleteId

  const athlete = useAthlete(athleteId)
  const briefing = useBriefing(athleteId)
  const team = useTeam()
  const exercises = useExercises()

  const [pad, setPad] = useState<PadState | null>(null)
  const [picker, setPicker] = useState<{ blockId: Uuid | null } | null>(null)
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null)
  const [finishOpen, setFinishOpen] = useState(false)
  const [finishing, setFinishing] = useState(false)

  // The pad's chips: what this athlete last did on THIS exercise, with the date and the coach
  // who wrote it. Keyed per athlete and exercise, so opening the pad on a block already on
  // screen is a cache hit rather than a round trip mid-set.
  const padLast = useLastPerformance(athleteId, pad?.exerciseId, sessionId)

  const addBlock = useAddBlock()
  const setBlockExercise = useSetBlockExercise()
  const deleteBlock = useDeleteBlock()
  const addSet = useAddSet()
  const updateSet = useUpdateSet()
  const deleteSet = useUndoableSetDelete()
  const updateSession = useUpdateSession()
  const finishSession = useFinishSession()
  const addNote = useAddNote()
  const setNotePinned = useSetNotePinned()

  useWakeLock(session?.status === 'active')

  const exerciseById = useMemo(
    () => new Map((exercises.data ?? []).map((exercise) => [exercise.id, exercise])),
    [exercises.data],
  )
  const memberName = useMemo(
    () => new Map((team.data ?? []).map((member) => [member.id, member.displayName])),
    [team.data],
  )

  const loggedByName = session ? (memberName.get(session.loggedBy) ?? null) : null
  // Rendered only when it actually differs. A permanent "credited to <the same person>" on
  // every session is an always-true line, and people learn to stop reading those.
  const creditedToName =
    session && session.creditedTo && session.creditedTo !== session.loggedBy
      ? (memberName.get(session.creditedTo) ?? null)
      : null

  const startRest = useCallback((seconds: number) => {
    // An absolute instant, not a countdown — see RestBar. A phone that sleeps through the whole
    // rest has to come back showing the truth.
    setRestEndsAt(Date.now() + seconds * 1000)
  }, [])

  const goBack = () =>
    location.key === 'default' ? navigate('/athletes', { replace: true }) : navigate(-1)

  // ---- writes -------------------------------------------------------------

  function openPadForNewSet(blockId: Uuid): void {
    const block = session?.blocks.find((candidate) => candidate.id === blockId)
    if (!block) return
    const exercise = exerciseById.get(block.exerciseId)
    const kind = blockSetKind(block, exercise)
    const previous = block.sets[block.sets.length - 1]
    setPad({
      blockId,
      exerciseId: block.exerciseId,
      exerciseLabel: exerciseName(exercise, locale),
      kind,
      setId: null,
      position: previous ? previous.position + 1 : 0,
      field: FIELD_SEQUENCE[kind][0],
      draft: EMPTY_DRAFT,
      restS: exercise?.defaultRestS ?? DEFAULT_REST_S,
    })
  }

  function openPadForSet(blockId: Uuid, set: WorkoutSet, field: SetField): void {
    const block = session?.blocks.find((candidate) => candidate.id === blockId)
    if (!block) return
    const exercise = exerciseById.get(block.exerciseId)
    setPad({
      blockId,
      exerciseId: block.exerciseId,
      exerciseLabel: exerciseName(exercise, locale),
      kind: set.kind,
      setId: set.id,
      position: set.position,
      field,
      draft: { loadKg: set.loadKg, reps: set.reps, seconds: set.seconds, meters: set.meters },
      restS: exercise?.defaultRestS ?? DEFAULT_REST_S,
    })
  }

  function commitPad(value: number): void {
    if (!sessionId || !athleteId || !pad) return
    const context = { sessionId, athleteId, exerciseId: pad.exerciseId }

    if (pad.setId) {
      updateSet.mutate({ ...context, setId: pad.setId, patch: withValue(pad.field, value) })
      setPad(null)
      return
    }

    const draft: Draft = { ...pad.draft, ...withValue(pad.field, value) }
    const sequence = FIELD_SEQUENCE[pad.kind]
    const next = sequence[sequence.indexOf(pad.field) + 1]
    // Straight on to the next field with the pad still up. Lowering and raising it between the
    // kilos and the reps is the difference between one thumb movement and two.
    if (next) {
      setPad({ ...pad, field: next, draft })
      return
    }

    addSet.mutate({
      ...context,
      id: newId(),
      blockId: pad.blockId,
      kind: pad.kind,
      position: pad.position,
      ...draft,
    })
    setPad(null)
    startRest(pad.restS)
  }

  function repeatLast(blockId: Uuid): void {
    if (!sessionId || !athleteId) return
    const block = session?.blocks.find((candidate) => candidate.id === blockId)
    const previous = block?.sets[block.sets.length - 1]
    if (!block || !previous) return
    addSet.mutate({
      sessionId,
      athleteId,
      exerciseId: block.exerciseId,
      id: newId(),
      blockId,
      kind: previous.kind,
      position: previous.position + 1,
      loadKg: previous.loadKg,
      reps: previous.reps,
      seconds: previous.seconds,
      meters: previous.meters,
      // The RPE is a judgement about one effort and is deliberately not cloned: the same load
      // repeated is usually harder, and copying "7" forward would put a claim in the sheet
      // that nobody made.
      rpe: null,
    })
    startRest(exerciseById.get(block.exerciseId)?.defaultRestS ?? DEFAULT_REST_S)
  }

  async function removeSet(exerciseId: Uuid, set: WorkoutSet): Promise<void> {
    if (!sessionId || !athleteId) return
    // Soft delete plus an undo, never a confirm: the row goes now, and the way back is a 44px
    // button for six seconds. `restoreSet` un-tombstones the same row, so it comes back with
    // its position and its author intact.
    const handle = await deleteSet.remove({ sessionId, athleteId, exerciseId, setId: set.id })
    const undo = handle.undo
    toast.show({
      message: t('log.setDeleted'),
      action: undo ? { label: t('common.undo'), onAction: () => void undo() } : undefined,
    })
  }

  function chooseExercise(exerciseId: Uuid): void {
    if (!session || !sessionId) return
    const target = picker?.blockId ?? null
    setPicker(null)
    if (target) {
      // Re-pointing an existing block keeps its sets, their positions and their authors. It is
      // the repair for "right numbers, wrong exercise", which is why removing a block can stay
      // restricted to empty ones.
      setBlockExercise.mutate({ sessionId, blockId: target, exerciseId })
      return
    }
    addBlock.mutate({ sessionId, blockId: newId(), exerciseId, position: session.blocks.length })
  }

  function removeBlock(blockId: Uuid): void {
    if (!sessionId) return
    deleteBlock.mutate({ sessionId, blockId })
    toast.show({ message: t('log.exerciseRemoved') })
  }

  function renameSession(title: string): void {
    if (!sessionId || !athleteId) return
    updateSession.mutate({ sessionId, athleteId, patch: { title: title === '' ? null : title } })
  }

  async function finish(payload: FinishPayload): Promise<void> {
    if (!session || !sessionId || !athleteId) return
    const standing = briefing.data?.latestNote ?? null

    if (payload.rpe !== null) {
      updateSession.mutate({
        sessionId,
        athleteId,
        patch: { notes: withSessionRpe(session.notes, payload.rpe) },
      })
    }

    if (payload.noteBody !== '' && payload.noteChanged) {
      addNote.mutate({
        id: newId(),
        athleteId,
        body: payload.noteBody,
        pinned: payload.notePinned,
        sessionId,
      })
    } else if (standing && payload.notePinned !== standing.pinned) {
      // Nothing new to say, but the standing note should (or should not) be at the top. The pin
      // is the only field of a note that can be corrected — the body is append-only.
      setNotePinned.mutate({ noteId: standing.id, athleteId, pinned: payload.notePinned })
    }

    setFinishing(true)
    try {
      // Status and `finished_at` only. It does NOT lock the session: a coach who remembers the
      // last set at the front desk has to be able to add it, or this is worse than paper.
      await finishSession.mutateAsync({ sessionId, athleteId })
      setFinishOpen(false)
      toast.show({ message: t('log.sessionFinished') })
    } finally {
      setFinishing(false)
    }
  }

  /**
   * The pad's chips. Both carry provenance because both are coaching numbers: the one from
   * this session says who is logging it, and the one from last time says the date and the coach
   * who wrote it. `KeypadSuggestion.meta` is required by its type for exactly this reason.
   *
   * The pad itself opens EMPTY rather than prefilled: its digit keys append, so a prefilled
   * "72,5" plus a thumb on "8" is 72,58 — in range, plausible, and silently wrong.
   */
  function suggestionsFor(state: PadState): KeypadSuggestion[] {
    const out: KeypadSuggestion[] = []
    const block = session?.blocks.find((candidate) => candidate.id === state.blockId)

    const own = state.setId
      ? block?.sets.find((candidate) => candidate.id === state.setId)
      : block?.sets[block.sets.length - 1]
    const ownValue = own ? fieldValue(own, state.field) : null
    if (ownValue !== null) {
      out.push({
        value: ownValue,
        label: chipLabel(state.field, ownValue, state.kind, locale),
        meta: [t('log.thisSession'), loggedByName].filter(Boolean).join(' · '),
      })
    }

    const last = padLast.data
    const lastValue = last ? lastValueOf(last, state.field) : null
    if (last && lastValue !== null && lastValue !== ownValue) {
      out.push({
        value: lastValue,
        label: chipLabel(state.field, lastValue, last.kind, locale),
        meta: [formatDate(last.date, locale), last.authorName].filter(Boolean).join(' · '),
      })
    }

    return out
  }

  // ---- render -------------------------------------------------------------

  if (tree.isLoading) {
    return (
      <Screen label={t('log.title')}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
          <Spinner label={t('common.loading')} />
        </div>
      </Screen>
    )
  }

  if (!session) {
    return (
      <Screen label={t('log.title')}>
        <EmptyState
          icon="alert"
          title={t('log.sessionMissing')}
          description={t('log.sessionMissingHint')}
          action={
            <Button variant="secondary" icon="back" onClick={goBack}>
              {t('errors.backToAthletes')}
            </Button>
          }
        />
      </Screen>
    )
  }

  const config = pad ? padConfig(pad.field) : null

  return (
    <>
      <Screen
        label={t('log.title')}
        header={
          <SessionHeader
            session={session}
            athlete={athlete.data}
            loggedByName={loggedByName}
            creditedToName={creditedToName}
            pinnedNotes={briefing.data?.pinnedNotes ?? []}
            volumeKg={sessionVolume(session)}
            setCount={sessionSets(session)}
            locale={locale}
            onBack={goBack}
            onTitleChange={renameSession}
          />
        }
        footer={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <RestBar
              endsAt={restEndsAt}
              onStart={startRest}
              onExtend={(seconds) =>
                // From now when the rest has already run out, so "+15" always buys 15 seconds
                // rather than expiring the instant it is tapped.
                setRestEndsAt((current) =>
                  Math.max(Date.now(), current ?? Date.now()) + seconds * 1000,
                )
              }
              onStop={() => setRestEndsAt(null)}
            />
            {/* Still offered after the session is finished, just no longer the loud action:
                finishing stamps a status, it does not lock anything, and a coach adding the
                note they thought of on the way to the desk needs this button to still work. */}
            <Button
              variant={session.status === 'finished' ? 'secondary' : 'primary'}
              block
              icon="check"
              onClick={() => setFinishOpen(true)}
            >
              {t('log.finish')}
            </Button>
          </div>
        }
      >
        {session.blocks.length === 0 ? (
          <EmptyState
            icon="dumbbell"
            title={t('log.noExercises')}
            description={t('log.noExercisesHint')}
          />
        ) : (
          session.blocks.map((block) => (
            <ExerciseBlock
              key={block.id}
              block={block}
              exercise={exerciseById.get(block.exerciseId)}
              athleteId={session.athleteId}
              sessionId={session.id}
              locale={locale}
              onPickExercise={() => setPicker({ blockId: block.id })}
              onAddSet={() => openPadForNewSet(block.id)}
              onRepeatLast={() => repeatLast(block.id)}
              onEditSet={(set, field) => openPadForSet(block.id, set, field)}
              onDeleteSet={(set) => void removeSet(block.exerciseId, set)}
              onRemove={() => removeBlock(block.id)}
            />
          ))
        )}

        <Button variant="secondary" block icon="plus" onClick={() => setPicker({ blockId: null })}>
          {t('log.addExercise')}
        </Button>
      </Screen>

      <ExercisePicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        athleteId={session.athleteId}
        locale={locale}
        onSelect={chooseExercise}
      />

      <FinishSheet
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        lastNote={briefing.data?.latestNote ?? null}
        busy={finishing}
        onSubmit={(payload) => void finish(payload)}
      />

      {pad && config ? (
        <Keypad
          // Remounted per field, so one field's digits can never carry over into the next and a
          // tap on a second number never appends to the first one's value.
          key={`${pad.setId ?? 'new'}-${pad.field}`}
          label={t('log.editValue', {
            field: t(`log.${fieldKey(pad.field)}`),
            exercise: pad.exerciseLabel,
          })}
          unit={config.unit}
          min={config.min}
          max={config.max}
          integer={config.integer}
          nudges={config.nudges}
          suggestions={suggestionsFor(pad)}
          onCommit={commitPad}
          onClose={() => setPad(null)}
        />
      ) : null}
    </>
  )
}
