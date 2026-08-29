/**
 * Progress analytics, ported from the prototype's helpers onto the flat row model.
 *
 * Everything here is a pure function over plain arrays: no I/O, no cache, no store.
 * That is what lets the same code run against a React Query cache on the Progress screen
 * and against a fixture in a test.
 *
 * The formulas are the prototype's. Four of its bugs are fixed rather than ported; each
 * fix is commented where it lives, because "the numbers changed" is otherwise an
 * unexplainable regression to whoever compares this to the prototype.
 */

import type {
  Block,
  Exercise,
  ExerciseCategory,
  LastPerformance,
  LocalDate,
  Membership,
  Session,
  SessionTree,
  SetKind,
  Uuid,
  WorkoutSet,
} from '@/domain/types'

/**
 * The rows analytics reads. Callers pass whatever slice of the cache they already hold;
 * `memberships` is optional because only `lastPerformance` needs a name and most screens
 * would otherwise have to load the roster to draw a chart.
 */
export interface AnalyticsData {
  sessions: readonly Session[]
  blocks: readonly Block[]
  sets: readonly WorkoutSet[]
  exercises: readonly Exercise[]
  memberships?: readonly Membership[]
}

export interface ExerciseUsage {
  exerciseId: Uuid
  /** Distinct sessions the exercise appears in. */
  sessions: number
  sets: number
}

export interface TrendPoint {
  sessionId: Uuid
  date: LocalDate
  /** Rounded Epley estimate of the session's best single. 0 when nothing was loaded. */
  oneRm: number
  topKg: number
  topReps: number
  volume: number
}

export interface ExerciseTrend {
  /** False when the exercise was never loaded — the chart must then plot reps, not 1RM. */
  weighted: boolean
  points: TrendPoint[]
}

export interface BodyPartSlice {
  category: ExerciseCategory
  sets: number
  volume: number
}

export interface BodyPartPoint {
  sessionId: Uuid
  date: LocalDate
  volume: number
  sets: number
}

export interface BodyPartTrend {
  /** False for a pure cardio/mobility category — plot set count instead of volume. */
  hasLoad: boolean
  points: BodyPartPoint[]
}

// ---------------------------------------------------------------------------
// Row predicates
// ---------------------------------------------------------------------------

/**
 * Tombstones live in the client cache until sync prunes them, so every traversal filters
 * them here rather than trusting the caller to have done it.
 */
function isLive(row: { deletedAt: string | null }): boolean {
  return row.deletedAt === null
}

/**
 * A set counts once it holds a measurement. `doneAt` alone is not the test: sessions are
 * logged after the fact, and a logger that forgets to stamp it would zero every total in
 * the app. Numbers on the row are the ground truth that a set happened.
 */
function isPerformed(set: WorkoutSet): boolean {
  return (
    set.doneAt !== null ||
    set.loadKg !== null ||
    set.reps !== null ||
    set.seconds !== null ||
    set.meters !== null
  )
}

function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

interface Index {
  blocksBySession: Map<Uuid, Block[]>
  setsByBlock: Map<Uuid, WorkoutSet[]>
  categoryByExercise: Map<Uuid, ExerciseCategory>
  nameByMembership: Map<Uuid, string>
}

function byPosition(a: { position: number; id: Uuid }, b: { position: number; id: Uuid }): number {
  // Two offline inserts can mint the same position, so `id` is the tiebreaker that keeps
  // the order identical on both devices.
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key)
  if (existing) existing.push(value)
  else map.set(key, [value])
}

/**
 * Rebuilt per call. A gym's whole history is a few thousand rows, so an index pass is
 * cheaper than the cache invalidation a memo would need.
 */
function buildIndex(data: AnalyticsData): Index {
  const blocksBySession = new Map<Uuid, Block[]>()
  const setsByBlock = new Map<Uuid, WorkoutSet[]>()
  const categoryByExercise = new Map<Uuid, ExerciseCategory>()
  const nameByMembership = new Map<Uuid, string>()

  for (const block of data.blocks) if (isLive(block)) push(blocksBySession, block.sessionId, block)
  for (const set of data.sets) if (isLive(set)) push(setsByBlock, set.blockId, set)
  for (const list of blocksBySession.values()) list.sort(byPosition)
  for (const list of setsByBlock.values()) list.sort(byPosition)

  for (const exercise of data.exercises) categoryByExercise.set(exercise.id, exercise.category)
  for (const member of data.memberships ?? []) nameByMembership.set(member.id, member.displayName)

  return { blocksBySession, setsByBlock, categoryByExercise, nameByMembership }
}

function setsOfBlock(index: Index, blockId: Uuid): WorkoutSet[] {
  return (index.setsByBlock.get(blockId) ?? []).filter(isPerformed)
}

function blocksOfSession(index: Index, sessionId: Uuid): Block[] {
  return index.blocksBySession.get(sessionId) ?? []
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

/**
 * Load moved by one set, in kilograms.
 *
 * FIX (prototype): it multiplied `kg × reps` across every set regardless of what the set
 * measured. Twenty minutes on the treadmill therefore contributed 0, exactly like ten
 * pull-ups, and "volume" quietly meant "volume of the barbell work only" — while still
 * being labelled the session total. The flat model carries `kind`, so only `weight_reps`
 * produces load now. `bodyweight` is explicitly zero: counting a weighted dip's +20 kg
 * while ignoring the 80 kg of athlete makes the number incomparable between athletes,
 * and a zero we can explain beats a number we cannot.
 */
export function setVolume(set: WorkoutSet): number {
  if (set.kind !== 'weight_reps') return 0
  const kg = num(set.loadKg)
  const reps = num(set.reps)
  if (kg <= 0 || reps <= 0) return 0
  return kg * reps
}

function toSets(input: readonly WorkoutSet[] | SessionTree): readonly WorkoutSet[] {
  if ('blocks' in input) {
    return input.blocks.filter(isLive).flatMap((block) => block.sets.filter(isLive))
  }
  // The flat branch filters too. Deletion is soft everywhere in this schema, so a
  // caller handing over rows straight from the cache is handing over tombstones,
  // and an unfiltered branch silently double-counts every set a coach removed.
  return input.filter(isLive)
}

/** Σ load×reps over a session's sets. Accepts a rehydrated tree or a flat set list. */
export function sessionVolume(input: readonly WorkoutSet[] | SessionTree): number {
  return toSets(input)
    .filter(isPerformed)
    .reduce((total, set) => total + setVolume(set), 0)
}

/** How many sets were actually performed, across every kind. */
export function sessionSets(input: readonly WorkoutSet[] | SessionTree): number {
  return toSets(input).filter(isPerformed).length
}

// ---------------------------------------------------------------------------
// Session ordering
// ---------------------------------------------------------------------------

/** Whose session this was: the editable credit, falling back to who typed it. */
export function sessionAuthorId(session: Session): Uuid {
  return session.creditedTo ?? session.loggedBy
}

/**
 * Chronological order of two sessions.
 *
 * FIX (prototype): it sorted on the date STRING alone. Two sessions on one day — the
 * normal case for an athlete doing a morning and an evening slot, and for a trainer
 * back-filling yesterday — came out in whatever order the array happened to hold, so the
 * trend chart and the "last time" hint could disagree with each other. `localDate` still
 * leads (it is the gym's day, not a UTC slice), `startedAt` breaks the tie, and `id`
 * makes the result total so two devices sort identically.
 */
export function compareSessions(a: Session, b: Session): number {
  if (a.localDate !== b.localDate) return a.localDate < b.localDate ? -1 : 1
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** An athlete's sessions, oldest first. */
export function athleteSessionsAsc(
  sessions: readonly Session[],
  athleteId: Uuid,
): Session[] {
  return sessions
    .filter((s) => isLive(s) && s.athleteId === athleteId)
    .slice()
    .sort(compareSessions)
}

// ---------------------------------------------------------------------------
// Strength estimate
// ---------------------------------------------------------------------------

/**
 * Epley one-rep-max estimate: `kg × (1 + reps/30)`.
 *
 * Zero for an unloaded set — an estimate from bodyweight reps is not a 1RM, and the
 * prototype's guard is the one piece of it that was already right.
 */
export function epley(kg: number | null | undefined, reps: number | null | undefined): number {
  const load = num(kg)
  if (load <= 0) return 0
  return load * (1 + num(reps) / 30)
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/**
 * Which exercises this athlete actually trains, most-used first.
 *
 * FIX (prototype): it incremented a counter per block, so an exercise that appeared in
 * two blocks of one session (a superset, or a coach who added it twice) looked twice as
 * frequent as one trained in two separate sessions. Sessions and sets are now counted
 * separately, and the caller picks which one it means.
 */
export function athleteExercises(data: AnalyticsData, athleteId: Uuid): ExerciseUsage[] {
  const index = buildIndex(data)
  const usage = new Map<Uuid, { sessions: Set<Uuid>; sets: number }>()

  for (const session of athleteSessionsAsc(data.sessions, athleteId)) {
    for (const block of blocksOfSession(index, session.id)) {
      const performed = setsOfBlock(index, block.id)
      if (performed.length === 0) continue
      const entry = usage.get(block.exerciseId) ?? { sessions: new Set<Uuid>(), sets: 0 }
      entry.sessions.add(session.id)
      entry.sets += performed.length
      usage.set(block.exerciseId, entry)
    }
  }

  return Array.from(usage, ([exerciseId, entry]) => ({
    exerciseId,
    sessions: entry.sessions.size,
    sets: entry.sets,
  })).sort(
    (a, b) =>
      b.sessions - a.sessions ||
      b.sets - a.sets ||
      (a.exerciseId < b.exerciseId ? -1 : a.exerciseId > b.exerciseId ? 1 : 0),
  )
}

/** One point per session in which the exercise was performed, oldest first. */
export function exerciseTrend(
  data: AnalyticsData,
  athleteId: Uuid,
  exerciseId: Uuid,
): ExerciseTrend {
  const index = buildIndex(data)
  const points: TrendPoint[] = []
  let weighted = false

  for (const session of athleteSessionsAsc(data.sessions, athleteId)) {
    const sets = blocksOfSession(index, session.id)
      .filter((block) => block.exerciseId === exerciseId)
      .flatMap((block) => setsOfBlock(index, block.id))
    if (sets.length === 0) continue

    let oneRm = 0
    let topKg = 0
    let topReps = 0
    let volume = 0
    for (const set of sets) {
      const kg = num(set.loadKg)
      const reps = num(set.reps)
      if (kg > 0) {
        weighted = true
        oneRm = Math.max(oneRm, epley(kg, reps))
        topKg = Math.max(topKg, kg)
      }
      topReps = Math.max(topReps, reps)
      volume += setVolume(set)
    }

    points.push({
      sessionId: session.id,
      date: session.localDate,
      oneRm: Math.round(oneRm),
      topKg,
      topReps,
      volume,
    })
  }

  return { weighted, points }
}

/**
 * How the athlete's sets are distributed across body parts.
 *
 * FIX (prototype): the category was denormalised onto the block at logging time, so
 * recategorising an exercise in the library left every historical block claiming the old
 * category — and the two disagreed forever after. Category is read from the exercise row
 * here, which is the only copy of it.
 */
export function bodyPartShare(data: AnalyticsData, athleteId: Uuid): BodyPartSlice[] {
  const index = buildIndex(data)
  const tally = new Map<ExerciseCategory, { sets: number; volume: number }>()

  for (const session of athleteSessionsAsc(data.sessions, athleteId)) {
    for (const block of blocksOfSession(index, session.id)) {
      const category = index.categoryByExercise.get(block.exerciseId)
      if (!category) continue
      const performed = setsOfBlock(index, block.id)
      if (performed.length === 0) continue
      const entry = tally.get(category) ?? { sets: 0, volume: 0 }
      entry.sets += performed.length
      entry.volume += performed.reduce((total, set) => total + setVolume(set), 0)
      tally.set(category, entry)
    }
  }

  return Array.from(tally, ([category, entry]) => ({ category, ...entry }))
    .filter((slice) => slice.sets > 0)
    .sort((a, b) => b.sets - a.sets || (a.category < b.category ? -1 : 1))
}

/** Volume and set count over time for one body part, oldest first. */
export function bodyPartTrend(
  data: AnalyticsData,
  athleteId: Uuid,
  category: ExerciseCategory,
): BodyPartTrend {
  const index = buildIndex(data)
  const points: BodyPartPoint[] = []
  let hasLoad = false

  for (const session of athleteSessionsAsc(data.sessions, athleteId)) {
    let volume = 0
    let sets = 0
    for (const block of blocksOfSession(index, session.id)) {
      if (index.categoryByExercise.get(block.exerciseId) !== category) continue
      const performed = setsOfBlock(index, block.id)
      sets += performed.length
      volume += performed.reduce((total, set) => total + setVolume(set), 0)
    }
    if (sets === 0) continue
    if (volume > 0) hasLoad = true
    points.push({ sessionId: session.id, date: session.localDate, volume, sets })
  }

  return { hasLoad, points }
}

// ---------------------------------------------------------------------------
// Last performance
// ---------------------------------------------------------------------------

/** Is `a` a better top set than `b`, for the given kind? */
function isBetter(a: WorkoutSet, b: WorkoutSet, kind: SetKind): boolean {
  switch (kind) {
    case 'weight_reps':
      return num(a.loadKg) !== num(b.loadKg)
        ? num(a.loadKg) > num(b.loadKg)
        : num(a.reps) > num(b.reps)
    case 'bodyweight':
      return num(a.reps) !== num(b.reps) ? num(a.reps) > num(b.reps) : num(a.loadKg) > num(b.loadKg)
    case 'duration':
      return num(a.seconds) > num(b.seconds)
    case 'distance':
      return num(a.meters) > num(b.meters)
  }
}

/** The kind most of the session's sets for this exercise were logged as. */
function dominantKind(sets: readonly WorkoutSet[]): SetKind {
  const counts = new Map<SetKind, number>()
  for (const set of sets) counts.set(set.kind, (counts.get(set.kind) ?? 0) + 1)
  let best: SetKind = sets[0].kind
  let bestCount = 0
  for (const [kind, count] of counts) {
    if (count > bestCount) {
      best = kind
      bestCount = count
    }
  }
  return best
}

/**
 * The top set this athlete last did on this exercise, before the session being edited.
 *
 * FIX (prototype), two bugs in one function:
 *  - it compared date strings with `<=` and then preferred a strictly-earlier DAY, so a
 *    session logged later on the same day was skipped in favour of last week's, and
 *    among same-day sessions the winner was whichever the array held first. Ordering is
 *    now the total `compareSessions` order and the answer is simply the nearest session
 *    strictly before the current one.
 *  - it therefore also surfaced numbers from a session logged AFTER the one being edited
 *    whenever a trainer back-filled a missed workout. The current session is excluded by
 *    id, and only earlier sessions are candidates.
 *
 * Returns the author with the number. The UI renders "80×8 · 12 Αυγ · Μαρία": a coach
 * loads a bar with this, and an unattributed number they cannot ask about is worse than
 * no number at all.
 */
export function lastPerformance(
  data: AnalyticsData,
  athleteId: Uuid,
  exerciseId: Uuid,
  currentSessionId: Uuid | null,
): LastPerformance | null {
  const index = buildIndex(data)
  const ordered = athleteSessionsAsc(data.sessions, athleteId)

  const current = currentSessionId
    ? (ordered.find((s) => s.id === currentSessionId) ?? null)
    : null
  // An unsaved session has no row yet; everything logged so far is then a candidate.
  const candidates = current
    ? ordered.filter((s) => s.id !== current.id && compareSessions(s, current) < 0)
    : ordered.filter((s) => s.id !== currentSessionId)

  for (let i = candidates.length - 1; i >= 0; i--) {
    const session = candidates[i]
    const sets = blocksOfSession(index, session.id)
      .filter((block) => block.exerciseId === exerciseId)
      .flatMap((block) => setsOfBlock(index, block.id))
    if (sets.length === 0) continue

    const kind = dominantKind(sets)
    const ofKind = sets.filter((set) => set.kind === kind)
    let top = ofKind[0]
    for (const set of ofKind) if (isBetter(set, top, kind)) top = set

    return {
      kind,
      loadKg: top.loadKg,
      reps: top.reps,
      seconds: top.seconds,
      meters: top.meters,
      date: session.localDate,
      authorName: index.nameByMembership.get(sessionAuthorId(session)) ?? null,
    }
  }

  return null
}
