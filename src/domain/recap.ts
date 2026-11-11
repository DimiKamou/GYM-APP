/**
 * A workout in the words the owner uses: «Στήθος · Bench Press · Μπάρα · 3×12 · 60 kg».
 *
 * The same rules as `streamlit/lib/recap.py`, so the two clients never read one workout two
 * ways while both are in use:
 *
 *  - all sets alike: sets × reps, then the load — «3×12 · 60 kg»;
 *  - not alike, or one set: every set as kilos × reps — «60×12, 65×10, 70×8». A pyramid summed
 *    into a range loses which weight went with which reps, and that is the number a coach loads;
 *  - the two halves of a superset say «Super set ·».
 *
 * Pure: no I/O. Labels that are words come from the caller's locale table below, the same way
 * `format.ts` carries its units.
 */

import { blockEquipment } from '@/domain/analytics'
import { EMPTY, formatWeight, type Locale } from '@/domain/format'
import type { Block, Equipment, Exercise, ProgramItem, Uuid, WorkoutSet } from '@/domain/types'

const NBSP = ' '

const WORDS = {
  el: { sets: 'σετ', sec: 'δευτ.', min: 'λεπτά', superset: 'Super set' },
  en: { sets: 'sets', sec: 's', min: 'min', superset: 'Superset' },
} as const

function kg(load: number, locale: Locale): string {
  return `${formatWeight(load, locale)}${NBSP}kg`
}

function duration(seconds: number, locale: Locale): string {
  const w = WORDS[locale]
  if (seconds < 60) return `${Math.round(seconds)}${NBSP}${w.sec}`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return rest === 0 ? `${minutes}${NBSP}${w.min}` : `${minutes}:${String(rest).padStart(2, '0')}`
}

function distance(meters: number, locale: Locale): string {
  return meters >= 1000 ? `${formatWeight(meters / 1000, locale)}${NBSP}km` : `${Math.round(meters)}${NBSP}m`
}

type SetLike = Pick<WorkoutSet, 'kind' | 'loadKg' | 'reps' | 'seconds' | 'meters'>

/** `count` identical sets: «3×12 · 60 kg», «3×10 · +10 kg», «2×45 δευτ. · 20 kg». */
export function runOf(count: number, set: SetLike, locale: Locale = 'el'): string {
  const w = WORDS[locale]
  const load = set.loadKg
  const reps = set.reps
  switch (set.kind) {
    case 'weight_reps':
      if (reps !== null && load !== null) return `${count}×${reps} · ${kg(load, locale)}`
      if (reps !== null) return `${count}×${reps}`
      if (load !== null) return `${count} ${w.sets} · ${kg(load, locale)}`
      return `${count} ${w.sets}`
    case 'bodyweight':
      if (reps === null) return `${count} ${w.sets}`
      return load !== null && load > 0 ? `${count}×${reps} · +${kg(load, locale)}` : `${count}×${reps}`
    case 'duration': {
      if (set.seconds === null || set.seconds < 0) return `${count} ${w.sets}`
      const held = `${count}×${duration(set.seconds, locale)}`
      return load !== null && load > 0 ? `${held} · ${kg(load, locale)}` : held
    }
    case 'distance':
      return set.meters === null || set.meters < 0 ? `${count} ${w.sets}` : `${count}×${distance(set.meters, locale)}`
  }
}

/** One set the way the set lines say it: «60×12» is kilos × reps; «20 kg×45 δευτ.» a held load. */
export function singleOf(set: SetLike, locale: Locale = 'el'): string {
  const load = set.loadKg
  const reps = set.reps
  switch (set.kind) {
    case 'weight_reps':
      if (reps !== null && load !== null) return `${formatWeight(load, locale)}×${reps}`
      if (reps !== null) return `×${reps}`
      return load !== null ? kg(load, locale) : EMPTY
    case 'bodyweight':
      if (reps === null) return EMPTY
      return load !== null && load > 0 ? `+${formatWeight(load, locale)}×${reps}` : `×${reps}`
    case 'duration':
      if (set.seconds === null || set.seconds < 0) return EMPTY
      return load !== null && load > 0
        ? `${kg(load, locale)}×${duration(set.seconds, locale)}`
        : duration(set.seconds, locale)
    case 'distance':
      return set.meters === null || set.meters < 0 ? EMPTY : distance(set.meters, locale)
  }
}

function byPosition<T extends { position: number; id: Uuid }>(a: T, b: T): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Sets that were done, in the order they were done. `doneAt` null is a prescription. */
export function performed<T extends Pick<WorkoutSet, 'doneAt' | 'position' | 'id'>>(sets: readonly T[]): T[] {
  return sets.filter((s) => s.doneAt !== null).sort(byPosition)
}

/** «3×12 · 60 kg» when all alike, «60×12, 65×10, 70×8» when not; "" when nothing was done. */
export function setsSummary(sets: readonly WorkoutSet[], locale: Locale = 'el'): string {
  const done = performed(sets)
  if (done.length === 0) return ''
  // Compared as printed, not column by column: 0 kg and no kg on a bodyweight set both read
  // «×10», and «1×10, 1×10, 1×10» beside a card that says «3×10» looks like three different sets.
  const first = singleOf(done[0], locale)
  if (done.length > 1 && done.every((s) => s.kind === done[0].kind && singleOf(s, locale) === first)) {
    return runOf(done.length, done[0], locale)
  }
  return done.map((s) => singleOf(s, locale)).join(', ')
}

export interface RecapContext {
  exercisesById: ReadonlyMap<Uuid, Exercise>
  /** The name of each exercise's primary muscle group. */
  primaryGroupOf: ReadonlyMap<Uuid, string>
  /** Every muscle group's name, for a block logged for a group other than the primary (012). */
  groupNameOf: ReadonlyMap<Uuid, string>
  exerciseName: (exercise: Exercise | undefined) => string
  equipmentName: (equipment: Equipment) => string
  locale: Locale
}

/**
 * One line per exercise of one workout that had a set done, in workout order. A block naming
 * a folded duplicate reads as the row it was folded into (one hop, as `exercises_guard_merge`
 * guarantees).
 */
export function workoutLines(
  blocks: readonly Block[],
  sets: readonly WorkoutSet[],
  ctx: RecapContext,
): string[] {
  const pairs = new Map<string, number>()
  for (const block of blocks) if (block.supersetId) pairs.set(block.supersetId, (pairs.get(block.supersetId) ?? 0) + 1)
  const setsOf = new Map<Uuid, WorkoutSet[]>()
  for (const set of sets) setsOf.set(set.blockId, [...(setsOf.get(set.blockId) ?? []), set])

  const lines: string[] = []
  for (const block of [...blocks].filter((b) => b.deletedAt === null).sort(byPosition)) {
    const summary = setsSummary(setsOf.get(block.id) ?? [], ctx.locale)
    if (!summary) continue
    let exercise = ctx.exercisesById.get(block.exerciseId)
    if (exercise?.mergedIntoId && ctx.exercisesById.has(exercise.mergedIntoId)) {
      exercise = ctx.exercisesById.get(exercise.mergedIntoId)
    }
    const group =
      (block.muscleGroupId ? ctx.groupNameOf.get(block.muscleGroupId) : undefined) ??
      ctx.primaryGroupOf.get(exercise?.id ?? block.exerciseId)
    // The block's own tool, else the one the exercise fixes; for an exercise that offers a
    // choice and a block that never said, nothing — a guessed «Μπάρα» on dumbbell kilos is
    // the misread the column exists to prevent.
    const options = exercise?.equipmentOptions ?? null
    const tool = block.equipment ?? (options && options.length >= 2 ? null : blockEquipment(block, exercise))
    const parts = [group, ctx.exerciseName(exercise), tool ? ctx.equipmentName(tool) : null, summary].filter(
      (part): part is string => Boolean(part),
    )
    const line = parts.join(' · ')
    lines.push(block.supersetId && (pairs.get(block.supersetId) ?? 0) >= 2 ? `${WORDS[ctx.locale].superset} · ${line}` : line)
  }
  return lines
}

/** What a programme prescribes, the way the owner says it: «3×12 · 60 kg», «3×45 δευτ.». */
export function targetText(item: Pick<ProgramItem, 'sets' | 'reps' | 'seconds' | 'loadKg' | 'note'>, locale: Locale = 'el'): string {
  const sets = item.sets || 1
  let head = item.seconds
    ? `${sets}×${duration(item.seconds, locale)}`
    : item.reps
      ? `${sets}×${item.reps}`
      : `${sets} ${WORDS[locale].sets}`
  if (item.loadKg) head += ` · ${kg(item.loadKg, locale)}`
  const note = item.note?.trim()
  return note ? `${head} — ${note}` : head
}

/** Superset id → its blocks, for the supersets that are still pairs. A widowed half is an ordinary block. */
export function supersetPairs<T extends Pick<Block, 'supersetId' | 'deletedAt'>>(blocks: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const block of blocks) {
    if (!block.supersetId || block.deletedAt !== null) continue
    out.set(block.supersetId, [...(out.get(block.supersetId) ?? []), block])
  }
  for (const [key, rows] of out) if (rows.length < 2) out.delete(key)
  return out
}

/** The step after the latest one, wrapping round; the first step when none was trained yet. */
export function nextProgramStep(sequence: readonly number[], lastStep: number | null): number {
  if (sequence.length === 0) return 0
  return lastStep === null ? 0 : (lastStep + 1) % sequence.length
}

/** «1-2-3», «1 2 1 3», «1,2,3» → [1, 2, 3]. Throws a message naming what is wrong. */
export function parseSequence(text: string, positions: readonly number[]): number[] {
  const parts = text.replace(/[,·\-]/g, ' ').split(/\s+/).filter(Boolean)
  if (parts.length === 0) throw new Error('empty')
  const order = parts.map((part) => {
    if (!/^\d+$/.test(part)) throw new Error(`not-a-number:${part}`)
    const n = Number(part)
    if (!positions.includes(n)) throw new Error(`no-day:${n}`)
    return n
  })
  if (order.length > 60) throw new Error('too-long')
  return order
}
