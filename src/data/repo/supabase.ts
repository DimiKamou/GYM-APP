/**
 * The same contract, against PostgREST.
 *
 * The shape that matters here is the split between reads and writes:
 *
 *  - **Reads go straight to PostgREST and throw on failure.** React Query already knows what
 *    to do with a rejected read — keep the last good data on screen and mark it stale — and
 *    swallowing the error here would leave a coach looking at an empty roster with no way to
 *    tell that it is empty because the request failed.
 *  - **Writes go into the outbox and return `queued`.** Not because offline is an edge case
 *    but because it is the normal case: the free-weights corner has no signal, and a write
 *    that awaited a round-trip would lose the set the coach just typed. `queued` is an honest
 *    answer the UI can render as a pending mark, not an error.
 *
 * Three columns are never sent, however tempting: `logged_by` and `created_by` are stamped by
 * triggers from `auth.uid()` and the second is frozen against update, and `local_date` is
 * derived from `started_at` in the gym's timezone. Sending them is at best ignored and at
 * worst rejected, and it would make the client the authority on provenance — which is the one
 * thing this schema refuses to let it be.
 *
 * Memberships, gyms and invites are deliberately NOT outbox entities: a privilege change is an
 * online, interactive act, never something replayed from a phone that has been in a pocket for
 * three days. Those four methods write directly and report `saved` or `failed`.
 */

import type { PostgrestError } from '@supabase/supabase-js'

import { lastPerformance as lastPerformanceOf } from '@/domain/analytics'
import { matches } from '@/domain/text'
import { createOutbox, createSupabaseTransport, type Outbox, type OutboxEntity } from '@/data/outbox'
// Type-only, so nothing at runtime points from the repository back up at the hooks layer.
// The capability cannot live on `Repo`: every method there takes a gym id that the person
// redeeming an invite does not have yet.
import type { InviteRedeemer } from '@/data/hooks/useTeam'
import { supabase } from '@/data/supabase'
import { briefingTopLines } from '@/data/repo/local'
import type {
  Appointment,
  Athlete,
  Block,
  Briefing,
  Exercise,
  Gym,
  Invite,
  LastPerformance,
  MemberRole,
  Membership,
  Note,
  Session,
  SessionTree,
  Uuid,
  WorkoutSet,
} from '@/domain/types'
import type {
  NewAppointmentInput,
  NewExerciseInput,
  NewSessionInput,
  NewSetInput,
  ProgressData,
  RecentExercise,
  Repo,
  WriteState,
} from '@/data/repo/types'

const DEFAULT_RECENT_LIMIT = 8
/** How far back the picker and the "last time" hint look. Three months of a 4×/week block. */
const RECENT_SESSION_WINDOW = 60

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const AUDIT = 'created_at, updated_at, deleted_at, created_by'
const GYM_COLS = `id, name, timezone, display_unit, ${AUDIT}`
const MEMBER_COLS = `id, gym_id, user_id, display_name, email, role, status, ${AUDIT}`
const ATHLETE_COLS = `id, gym_id, full_name, coach_membership_id, plan_phase, plan_focus, birth_date, phone, email, ${AUDIT}`
const EXERCISE_COLS = `id, gym_id, name_el, name_en, category, equipment, default_set_kind, default_rest_s, merged_into_id, is_archived, ${AUDIT}`
const SESSION_COLS = `id, gym_id, athlete_id, logged_by, credited_to, appointment_id, title, notes, status, started_at, finished_at, local_date, ${AUDIT}`
const BLOCK_COLS = `id, gym_id, session_id, exercise_id, position, ${AUDIT}`
const SET_COLS = `id, gym_id, block_id, position, kind, target_kg, target_reps, load_kg, reps, seconds, meters, rpe, note, done_at, ${AUDIT}`
const NOTE_COLS = 'id, gym_id, athlete_id, session_id, body, pinned, author, dismissed_at, dismissed_by, created_at'
const APPOINTMENT_COLS = `id, gym_id, athlete_id, membership_id, date, time, duration_min, type, notes, status, session_id, ${AUDIT}`

// ---------------------------------------------------------------------------
// Row → domain
// ---------------------------------------------------------------------------

/**
 * A PostgREST row. The generated `Database` type needs a live project to produce, and a
 * hand-written stand-in would be a second copy of `@/domain/types` drifting away from it, so
 * rows are asserted at the mapping site — which is the only place in the app that touches
 * snake_case at all.
 */
type Row = Record<string, unknown>

function str(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * `numeric` columns can arrive as JSON strings depending on the PostgREST version, and
 * `Number("72.5")` is fine while a silent `NaN` from anything else would poison every volume
 * total downstream. Anything that is not a finite number becomes null, which renders as "—".
 */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function audit(row: Row) {
  return {
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    deletedAt: strOrNull(row.deleted_at),
    createdBy: strOrNull(row.created_by),
  }
}

function toGym(row: Row): Gym {
  return {
    id: str(row.id),
    name: str(row.name),
    timezone: str(row.timezone),
    displayUnit: row.display_unit === 'lb' ? 'lb' : 'kg',
    ...audit(row),
  }
}

function toMembership(row: Row): Membership {
  return {
    id: str(row.id),
    gymId: str(row.gym_id),
    userId: strOrNull(row.user_id),
    displayName: str(row.display_name),
    email: str(row.email),
    role: row.role as MemberRole,
    status: row.status as Membership['status'],
    ...audit(row),
  }
}

function toAthlete(row: Row): Athlete {
  return {
    id: str(row.id),
    gymId: str(row.gym_id),
    fullName: str(row.full_name),
    coachMembershipId: strOrNull(row.coach_membership_id),
    planPhase: strOrNull(row.plan_phase),
    planFocus: strOrNull(row.plan_focus),
    birthDate: strOrNull(row.birth_date),
    phone: strOrNull(row.phone),
    email: strOrNull(row.email),
    ...audit(row),
  }
}

function toExercise(row: Row): Exercise {
  return {
    id: str(row.id),
    gymId: strOrNull(row.gym_id),
    nameEl: strOrNull(row.name_el),
    nameEn: strOrNull(row.name_en),
    category: row.category as Exercise['category'],
    equipment: row.equipment as Exercise['equipment'],
    defaultSetKind: row.default_set_kind as Exercise['defaultSetKind'],
    defaultRestS: num(row.default_rest_s) ?? 90,
    mergedIntoId: strOrNull(row.merged_into_id),
    isArchived: row.is_archived === true,
    ...audit(row),
  }
}

function toSession(row: Row): Session {
  return {
    id: str(row.id),
    gymId: str(row.gym_id),
    athleteId: str(row.athlete_id),
    loggedBy: str(row.logged_by),
    creditedTo: strOrNull(row.credited_to),
    appointmentId: strOrNull(row.appointment_id),
    title: strOrNull(row.title),
    notes: strOrNull(row.notes),
    status: row.status === 'finished' ? 'finished' : 'active',
    startedAt: str(row.started_at),
    finishedAt: strOrNull(row.finished_at),
    localDate: str(row.local_date),
    ...audit(row),
  }
}

function toBlock(row: Row): Block {
  return {
    id: str(row.id),
    gymId: str(row.gym_id),
    sessionId: str(row.session_id),
    exerciseId: str(row.exercise_id),
    position: num(row.position) ?? 0,
    ...audit(row),
  }
}

function toSet(row: Row): WorkoutSet {
  return {
    id: str(row.id),
    gymId: str(row.gym_id),
    blockId: str(row.block_id),
    position: num(row.position) ?? 0,
    kind: row.kind as WorkoutSet['kind'],
    targetKg: num(row.target_kg),
    targetReps: num(row.target_reps),
    loadKg: num(row.load_kg),
    reps: num(row.reps),
    seconds: num(row.seconds),
    meters: num(row.meters),
    rpe: num(row.rpe),
    note: strOrNull(row.note),
    doneAt: strOrNull(row.done_at),
    ...audit(row),
  }
}

function toNote(row: Row): Note {
  return {
    id: str(row.id),
    gymId: str(row.gym_id),
    athleteId: str(row.athlete_id),
    sessionId: strOrNull(row.session_id),
    body: str(row.body),
    pinned: row.pinned === true,
    author: str(row.author),
    createdAt: str(row.created_at),
    dismissedAt: strOrNull(row.dismissed_at),
    dismissedBy: strOrNull(row.dismissed_by),
  }
}

function toAppointment(row: Row): Appointment {
  return {
    id: str(row.id),
    gymId: str(row.gym_id),
    athleteId: str(row.athlete_id),
    membershipId: strOrNull(row.membership_id),
    date: str(row.date),
    // Postgres `time` comes back as "08:30:00"; the domain contract says "HH:mm".
    time: str(row.time).slice(0, 5),
    durationMin: num(row.duration_min) ?? 60,
    type: row.type as Appointment['type'],
    notes: strOrNull(row.notes),
    status: row.status === 'done' ? 'done' : 'scheduled',
    sessionId: strOrNull(row.session_id),
    ...audit(row),
  }
}

function toInvite(row: Row): Invite {
  return {
    id: str(row.id),
    gymId: str(row.gym_id ?? ''),
    email: strOrNull(row.email),
    role: row.role as MemberRole,
    expiresAt: str(row.expires_at),
    maxUses: num(row.max_uses) ?? 1,
    uses: num(row.uses) ?? 0,
    revokedAt: strOrNull(row.revoked_at),
    acceptedAt: strOrNull(row.accepted_at),
    acceptedBy: strOrNull(row.accepted_by),
    createdAt: str(row.created_at),
  }
}

// ---------------------------------------------------------------------------
// Query plumbing
// ---------------------------------------------------------------------------

interface Answer<T> {
  data: T | null
  error: PostgrestError | null
}

/** Reads throw. React Query turns that into a retry and a stale-but-readable screen. */
function rows<T>(answer: Answer<unknown[]>, map: (row: Row) => T): T[] {
  if (answer.error) throw new Error(answer.error.message)
  return ((answer.data ?? []) as Row[]).map(map)
}

function first<T>(answer: Answer<unknown[]>, map: (row: Row) => T): T | null {
  const list = rows(answer, map)
  return list[0] ?? null
}

/**
 * One outbox per gym, kept for the life of the tab.
 *
 * It is cached rather than constructed per call because the queue's ordering and its backoff
 * live in the instance: a fresh Outbox for every write would drain the same rows twice and
 * reset the retry timer on each attempt.
 */
const outboxes = new Map<Uuid, Outbox>()

export function outboxFor(gymId: Uuid): Outbox {
  const existing = outboxes.get(gymId)
  if (existing) return existing
  const created = createOutbox({ gymId, transport: createSupabaseTransport(supabase) })
  outboxes.set(gymId, created)
  // Attaches the online/visibilitychange triggers and flushes whatever a previous tab left.
  created.start()
  return created
}

/** Every mutation takes this path. The op is durable before the caller is told anything. */
async function enqueue(
  gymId: Uuid,
  entity: OutboxEntity,
  id: Uuid,
  payload: Record<string, unknown>,
): Promise<WriteState> {
  try {
    await outboxFor(gymId).enqueue({ entity, action: 'upsert', id, payload })
    void outboxFor(gymId).drain()
    return 'queued'
  } catch {
    // The queue itself could not be written — the only case where a coach's input is really
    // gone, and the one the UI must not render as saved.
    return 'failed'
  }
}

async function enqueueDelete(gymId: Uuid, entity: OutboxEntity, id: Uuid): Promise<WriteState> {
  try {
    await outboxFor(gymId).enqueue({ entity, action: 'delete', id })
    void outboxFor(gymId).drain()
    return 'queued'
  } catch {
    return 'failed'
  }
}

/** Drops the keys a patch did not mention, so an omitted field keeps its stored value. */
function defined(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) if (value !== undefined) out[key] = value
  return out
}

async function direct(run: () => Promise<{ error: PostgrestError | null }>): Promise<WriteState> {
  try {
    const { error } = await run()
    return error ? 'failed' : 'saved'
  } catch {
    return 'failed'
  }
}

// ---------------------------------------------------------------------------

export function createSupabaseRepo(): Repo & InviteRedeemer {
  async function liveSessions(gymId: Uuid, athleteId: Uuid, limit?: number): Promise<Session[]> {
    let query = supabase
      .from('sessions')
      .select(SESSION_COLS)
      .eq('gym_id', gymId)
      .eq('athlete_id', athleteId)
      .is('deleted_at', null)
      .order('local_date', { ascending: false })
      .order('started_at', { ascending: false })
    if (limit !== undefined) query = query.limit(limit)
    return rows(await query, toSession)
  }

  async function blocksFor(gymId: Uuid, sessionIds: readonly Uuid[]): Promise<Block[]> {
    if (sessionIds.length === 0) return []
    return rows(
      await supabase
        .from('blocks')
        .select(BLOCK_COLS)
        .eq('gym_id', gymId)
        .in('session_id', sessionIds as string[])
        .is('deleted_at', null),
      toBlock,
    )
  }

  async function setsFor(gymId: Uuid, blockIds: readonly Uuid[]): Promise<WorkoutSet[]> {
    if (blockIds.length === 0) return []
    return rows(
      await supabase
        .from('sets')
        .select(SET_COLS)
        .eq('gym_id', gymId)
        .in('block_id', blockIds as string[])
        .is('deleted_at', null),
      toSet,
    )
  }

  async function team(gymId: Uuid): Promise<Membership[]> {
    return rows(
      await supabase.from('memberships').select(MEMBER_COLS).eq('gym_id', gymId).is('deleted_at', null),
      toMembership,
    )
  }

  async function catalogue(gymId: Uuid): Promise<Exercise[]> {
    // The shared catalogue (`gym_id is null`) plus this gym's own additions, in one round-trip.
    return rows(
      await supabase
        .from('exercises')
        .select(EXERCISE_COLS)
        .or(`gym_id.is.null,gym_id.eq.${gymId}`)
        .is('deleted_at', null),
      toExercise,
    )
  }

  const repo: Repo & InviteRedeemer = {
    kind: 'supabase',

    // ---- reads ----

    async getGym(gymId) {
      return first(await supabase.from('gyms').select(GYM_COLS).eq('id', gymId).limit(1), toGym)
    },

    async listTeam(gymId) {
      const members = await team(gymId)
      return members
        .filter((m) => m.status !== 'removed')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },

    async listInvites(gymId) {
      // `invites` has no SELECT policy — not even for the owner, because the row carries the
      // token hash. `list_invites()` is the read path and it cannot return that column.
      const { data, error } = await supabase.rpc('list_invites')
      if (error) throw new Error(error.message)
      return (
        ((data ?? []) as Row[])
          .map((row) => toInvite({ ...row, gym_id: gymId }))
          // The RPC is the audit view and returns spent invites too. The screen's list is a
          // list of things still to act on, and it carries a Revoke button next to every row:
          // offering to revoke an invite somebody already accepted is an offer to do nothing.
          .filter((invite) => invite.revokedAt === null && invite.acceptedAt === null)
      )
    },

    async listAthletes(gymId, search) {
      const found = rows(
        await supabase
          .from('athletes')
          .select(ATHLETE_COLS)
          .eq('gym_id', gymId)
          .is('deleted_at', null)
          .order('full_name', { ascending: true }),
        toAthlete,
      )
      // Filtered here rather than with `ilike`: Postgres' ilike is neither accent- nor
      // final-sigma-insensitive, so "παπ" would miss "Παπαδόπουλος" typed without accents.
      return search ? found.filter((a) => matches(a.fullName, search)) : found
    },

    async getAthlete(gymId, athleteId) {
      return first(
        await supabase
          .from('athletes')
          .select(ATHLETE_COLS)
          .eq('gym_id', gymId)
          .eq('id', athleteId)
          .is('deleted_at', null)
          .limit(1),
        toAthlete,
      )
    },

    async getBriefing(gymId, athleteId): Promise<Briefing | null> {
      const athlete = await repo.getAthlete(gymId, athleteId)
      if (!athlete) return null

      const [members, noteRows, sessions] = await Promise.all([
        team(gymId),
        rows(
          await supabase
            .from('notes')
            .select(NOTE_COLS)
            .eq('gym_id', gymId)
            .eq('athlete_id', athleteId)
            .is('dismissed_at', null)
            .is('deleted_at', null)
            .order('created_at', { ascending: false }),
          toNote,
        ),
        liveSessions(gymId, athleteId, 1),
      ])

      const nameOf = (id: Uuid | null): string | null =>
        id ? (members.find((m) => m.id === id)?.displayName ?? null) : null
      const withAuthor = (note: Note) => ({ ...note, authorName: nameOf(note.author) })

      const last = sessions[0] ?? null
      let lastSession: Briefing['lastSession'] = null
      if (last) {
        const blocks = await blocksFor(gymId, [last.id])
        const sets = await setsFor(gymId, blocks.map((b) => b.id))
        lastSession = {
          id: last.id,
          localDate: last.localDate,
          title: last.title,
          authorName: nameOf(last.creditedTo ?? last.loggedBy),
          topLines: briefingTopLines(blocks, sets, await catalogue(gymId)),
        }
      }

      return {
        athlete,
        coachName: nameOf(athlete.coachMembershipId),
        pinnedNotes: noteRows.filter((n) => n.pinned).map(withAuthor),
        latestNote: noteRows[0] ? withAuthor(noteRows[0]) : null,
        lastSession,
      }
    },

    async listAthleteSessions(gymId, athleteId) {
      return liveSessions(gymId, athleteId)
    },

    async listNotes(gymId, athleteId) {
      const [members, noteRows] = await Promise.all([
        team(gymId),
        rows(
          await supabase
            .from('notes')
            .select(NOTE_COLS)
            .eq('gym_id', gymId)
            .eq('athlete_id', athleteId)
            .is('deleted_at', null)
            .order('created_at', { ascending: false }),
          toNote,
        ),
      ])
      return noteRows.map((note) => ({
        ...note,
        authorName: members.find((m) => m.id === note.author)?.displayName ?? null,
      }))
    },

    async getProgressData(gymId, athleteId): Promise<ProgressData> {
      const sessions = await liveSessions(gymId, athleteId)
      const blocks = await blocksFor(gymId, sessions.map((s) => s.id))
      const [sets, exercises] = await Promise.all([
        setsFor(gymId, blocks.map((b) => b.id)),
        catalogue(gymId),
      ])
      return {
        sessions,
        blocks: blocks.map((b) => ({
          id: b.id,
          sessionId: b.sessionId,
          exerciseId: b.exerciseId,
          position: b.position,
          deletedAt: b.deletedAt,
        })),
        sets,
        exercises,
      }
    },

    async getSessionTree(gymId, sessionId): Promise<SessionTree | null> {
      const session = first(
        await supabase
          .from('sessions')
          .select(SESSION_COLS)
          .eq('gym_id', gymId)
          .eq('id', sessionId)
          .is('deleted_at', null)
          .limit(1),
        toSession,
      )
      if (!session) return null

      const blocks = await blocksFor(gymId, [sessionId])
      const sets = await setsFor(gymId, blocks.map((b) => b.id))
      const byPosition = (a: { position: number; id: Uuid }, b: { position: number; id: Uuid }) =>
        a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

      return {
        ...session,
        // Sorted client-side by `(position, id)`: two offline inserts can mint the same
        // position, and an `order('position')` alone would let the two devices disagree.
        blocks: [...blocks].sort(byPosition).map((block) => ({
          ...block,
          sets: sets.filter((s) => s.blockId === block.id).sort(byPosition),
        })),
      }
    },

    async listExercises(gymId) {
      return (await catalogue(gymId))
        .filter((e) => e.mergedIntoId === null)
        .sort((a, b) => (a.nameEl ?? a.nameEn ?? '').localeCompare(b.nameEl ?? b.nameEn ?? '', 'el'))
    },

    async listRecentExercises(gymId, athleteId, limit = DEFAULT_RECENT_LIMIT) {
      const [sessions, exercises] = await Promise.all([
        liveSessions(gymId, athleteId, RECENT_SESSION_WINDOW),
        catalogue(gymId),
      ])
      const byId = new Map(exercises.map((e) => [e.id, e]))
      const blocks = await blocksFor(gymId, sessions.map((s) => s.id))
      const order = new Map(sessions.map((s, i) => [s.id, i]))

      const seen = new Map<Uuid, { lastUsed: string; sessions: Set<Uuid> }>()
      for (const block of [...blocks].sort(
        (a, b) => (order.get(a.sessionId) ?? 0) - (order.get(b.sessionId) ?? 0),
      )) {
        const session = sessions.find((s) => s.id === block.sessionId)
        if (!session) continue
        const entry = seen.get(block.exerciseId)
        if (entry) entry.sessions.add(session.id)
        else seen.set(block.exerciseId, { lastUsed: session.localDate, sessions: new Set([session.id]) })
      }

      const recent: RecentExercise[] = []
      for (const [exerciseId, entry] of seen) {
        const exercise = byId.get(exerciseId)
        if (!exercise) continue
        recent.push({ exercise, lastUsed: entry.lastUsed, timesUsed: entry.sessions.size })
        if (recent.length === limit) break
      }
      if (recent.length > 0) return recent

      // A brand-new athlete: the gym's own habits beat an empty list, and the first session
      // with a client is exactly when a coach has least attention to spare for a search box.
      const gymSessions = rows(
        await supabase
          .from('sessions')
          .select(SESSION_COLS)
          .eq('gym_id', gymId)
          .is('deleted_at', null)
          .order('local_date', { ascending: false })
          .limit(200),
        toSession,
      )
      const gymBlocks = await blocksFor(gymId, gymSessions.map((s) => s.id))
      const dateOf = new Map(gymSessions.map((s) => [s.id, s.localDate]))
      const tally = new Map<Uuid, { lastUsed: string; sessions: Set<Uuid> }>()
      for (const block of gymBlocks) {
        const date = dateOf.get(block.sessionId)
        if (!date) continue
        const entry = tally.get(block.exerciseId)
        if (!entry) {
          tally.set(block.exerciseId, { lastUsed: date, sessions: new Set([block.sessionId]) })
          continue
        }
        entry.sessions.add(block.sessionId)
        if (date > entry.lastUsed) entry.lastUsed = date
      }

      return Array.from(tally, ([exerciseId, entry]) => ({ exerciseId, entry }))
        .sort(
          (a, b) =>
            b.entry.sessions.size - a.entry.sessions.size ||
            b.entry.lastUsed.localeCompare(a.entry.lastUsed) ||
            (a.exerciseId < b.exerciseId ? -1 : 1),
        )
        .flatMap(({ exerciseId, entry }) => {
          const exercise = byId.get(exerciseId)
          if (!exercise) return []
          return [{ exercise, lastUsed: entry.lastUsed, timesUsed: entry.sessions.size }]
        })
        .slice(0, limit)
    },

    async getLastPerformance(gymId, athleteId, exerciseId, excludeSessionId): Promise<LastPerformance | null> {
      const [sessions, members, exercises] = await Promise.all([
        liveSessions(gymId, athleteId, RECENT_SESSION_WINDOW),
        team(gymId),
        catalogue(gymId),
      ])
      const blocks = (await blocksFor(gymId, sessions.map((s) => s.id))).filter(
        (b) => b.exerciseId === exerciseId,
      )
      const sets = await setsFor(gymId, blocks.map((b) => b.id))
      // The ordering, the exclusion of the current session and the "nearest earlier session"
      // rule all live in one tested pure function, so both repositories cannot disagree.
      return lastPerformanceOf(
        { sessions, blocks, sets, exercises, memberships: members },
        athleteId,
        exerciseId,
        excludeSessionId ?? null,
      )
    },

    async listAppointments(gymId, from, to) {
      return rows(
        await supabase
          .from('appointments')
          .select(APPOINTMENT_COLS)
          .eq('gym_id', gymId)
          .gte('date', from)
          .lte('date', to)
          .is('deleted_at', null)
          .order('date', { ascending: true })
          .order('time', { ascending: true }),
        toAppointment,
      )
    },

    // ---- writes ----

    createSession(gymId, input: NewSessionInput) {
      return enqueue(gymId, 'sessions', input.id, {
        id: input.id,
        athlete_id: input.athleteId,
        title: input.title ?? null,
        status: 'active',
        started_at: input.startedAt ?? new Date().toISOString(),
        // No logged_by: sessions_stamp_author() sets it from auth.uid() and the guard trigger
        // refuses to let it change afterwards. No local_date either — it is derived from
        // started_at in the gym's timezone, which the client must not second-guess.
      })
    },

    updateSession(gymId, sessionId, patch) {
      return enqueue(
        gymId,
        'sessions',
        sessionId,
        defined({
          title: patch.title,
          notes: patch.notes,
          credited_to: patch.creditedTo,
          local_date: patch.localDate,
        }),
      )
    },

    finishSession(gymId, sessionId) {
      return enqueue(gymId, 'sessions', sessionId, {
        status: 'finished',
        finished_at: new Date().toISOString(),
      })
    },

    deleteSession: (gymId, sessionId) => enqueueDelete(gymId, 'sessions', sessionId),

    addBlock(gymId, sessionId, blockId, exerciseId, position) {
      return enqueue(gymId, 'blocks', blockId, {
        id: blockId,
        session_id: sessionId,
        exercise_id: exerciseId,
        position,
      })
    },

    setBlockExercise: (gymId, blockId, exerciseId) =>
      enqueue(gymId, 'blocks', blockId, { exercise_id: exerciseId }),

    deleteBlock: (gymId, blockId) => enqueueDelete(gymId, 'blocks', blockId),

    addSet(gymId, input: NewSetInput) {
      const measured =
        input.loadKg != null || input.reps != null || input.seconds != null || input.meters != null
      return enqueue(gymId, 'sets', input.id, {
        id: input.id,
        block_id: input.blockId,
        position: input.position,
        kind: input.kind,
        load_kg: input.loadKg ?? null,
        reps: input.reps ?? null,
        seconds: input.seconds ?? null,
        meters: input.meters ?? null,
        rpe: input.rpe ?? null,
        // Sessions are logged after the fact, so a set that carries numbers already happened.
        // `sets_complete_for_kind` also refuses a done_at without the matching measurement.
        done_at: measured ? new Date().toISOString() : null,
      })
    },

    updateSet(gymId, setId, patch) {
      return enqueue(
        gymId,
        'sets',
        setId,
        defined({
          load_kg: patch.loadKg,
          reps: patch.reps,
          seconds: patch.seconds,
          meters: patch.meters,
          rpe: patch.rpe,
          note: patch.note,
          done_at: patch.doneAt,
        }),
      )
    },

    deleteSet: (gymId, setId) => enqueueDelete(gymId, 'sets', setId),

    // An upsert clearing the tombstone, not a re-insert: the set keeps its id, position and
    // author, and the op coalescer keeps it ordered after the delete it undoes.
    restoreSet: (gymId, setId) => enqueue(gymId, 'sets', setId, { deleted_at: null }),

    createAthlete: (gymId, athleteId, fullName) =>
      enqueue(gymId, 'athletes', athleteId, { id: athleteId, full_name: fullName.trim() }),

    updateAthlete(gymId, athleteId, patch) {
      return enqueue(
        gymId,
        'athletes',
        athleteId,
        defined({
          full_name: patch.fullName,
          coach_membership_id: patch.coachMembershipId,
          plan_phase: patch.planPhase,
          plan_focus: patch.planFocus,
          phone: patch.phone,
          email: patch.email,
          birth_date: patch.birthDate,
        }),
      )
    },

    archiveAthlete: (gymId, athleteId) => enqueueDelete(gymId, 'athletes', athleteId),

    createExercise(gymId, input: NewExerciseInput) {
      return enqueue(gymId, 'exercises', input.id, {
        id: input.id,
        name_el: input.nameEl.trim(),
        name_en: input.nameEn ?? null,
        category: input.category,
        equipment: input.equipment,
        default_set_kind: input.defaultSetKind ?? 'weight_reps',
      })
    },

    // Archived, never tombstoned: historical blocks reference this row, and `exercises` is
    // ON DELETE RESTRICT precisely so a library tidy-up cannot orphan three months of logs.
    archiveExercise: (gymId, exerciseId) =>
      enqueue(gymId, 'exercises', exerciseId, { is_archived: true }),

    unarchiveExercise: (gymId, exerciseId) =>
      enqueue(gymId, 'exercises', exerciseId, { is_archived: false }),

    addNote(gymId, noteId, athleteId, body, opts) {
      return enqueue(gymId, 'notes', noteId, {
        id: noteId,
        athlete_id: athleteId,
        session_id: opts?.sessionId ?? null,
        body: body.trim(),
        pinned: opts?.pinned ?? false,
        // `author` is NOT sent: stamp_created_by() and the notes INSERT policy both derive it
        // from app.my_membership(), and a client-chosen author is an attribution forgery.
      })
    },

    setNotePinned: (gymId, noteId, pinned) => enqueue(gymId, 'notes', noteId, { pinned }),

    dismissNote: (gymId, noteId) =>
      enqueue(gymId, 'notes', noteId, { dismissed_at: new Date().toISOString() }),

    createAppointment(gymId, input: NewAppointmentInput) {
      return enqueue(gymId, 'appointments', input.id, {
        id: input.id,
        athlete_id: input.athleteId,
        membership_id: input.membershipId,
        date: input.date,
        time: input.time,
        duration_min: input.durationMin ?? 60,
        type: input.type,
        notes: input.notes ?? null,
        status: 'scheduled',
      })
    },

    updateAppointment(gymId, appointmentId, patch) {
      return enqueue(
        gymId,
        'appointments',
        appointmentId,
        defined({
          date: patch.date,
          time: patch.time,
          duration_min: patch.durationMin,
          type: patch.type,
          notes: patch.notes,
          status: patch.status,
          membership_id: patch.membershipId,
          session_id: patch.sessionId,
        }),
      )
    },

    deleteAppointment: (gymId, appointmentId) =>
      enqueueDelete(gymId, 'appointments', appointmentId),

    // ---- online-only writes ----

    updateGym(gymId, patch) {
      return direct(async () =>
        supabase
          .from('gyms')
          .update(defined({ name: patch.name, timezone: patch.timezone, display_unit: patch.displayUnit }))
          .eq('id', gymId),
      )
    },

    async inviteTrainer(_gymId, email, role: MemberRole) {
      const address = email.trim().toLowerCase()
      const { data, error } = await supabase.rpc('create_invite', {
        p_email: address === '' ? null : address,
        p_role: role,
      })
      if (error) return { state: 'failed' }
      const secret = (data as { secret?: string } | null)?.secret
      // The secret is in this response and nowhere else, ever again. If the caller drops it,
      // the only remedy is to revoke the invite and mint another.
      return secret ? { state: 'saved', secret } : { state: 'saved' }
    },

    async revokeInvite(_gymId, inviteId) {
      const { error } = await supabase.rpc('revoke_invite', { p_invite: inviteId })
      return error ? 'failed' : 'saved'
    },

    /**
     * No gym id: the caller does not have one yet, and the server takes the identity from
     * `auth.uid()` and the gym from the invite. The RPC answers `invalid or expired invite`
     * for every failure mode there is, so there is nothing to inspect on the error — only
     * whether one arrived.
     */
    async redeemInvite(secret) {
      const { data, error } = await supabase.rpc('redeem_invite', { p_secret: secret.trim() })
      if (error) return { ok: false }
      const row = (data ?? null) as {
        membership_id?: string
        gym_id?: string
        role?: MemberRole
      } | null
      if (!row?.gym_id || !row.membership_id) return { ok: false }
      return {
        ok: true,
        invite: {
          gymId: row.gym_id,
          membershipId: row.membership_id,
          role: row.role ?? 'trainer',
          // The response is byte-identical whether this was the first redemption or a repeat
          // of one, on purpose. The Join screen compares against the membership it already
          // held instead of asking the server to tell it apart.
          alreadyMember: false,
        },
      }
    },

    async updateMember(gymId, membershipId, patch) {
      // Promotion to owner is `transfer_ownership()`, never a PATCH — and this is not a
      // convenience. `memberships_one_active_owner` allows at most one active owner, so an
      // UPDATE that promotes the successor is refused; `memberships_guard_privilege` refuses
      // an owner stepping down before a successor exists. The two halves only work as one
      // server-side transaction, which also means a client cannot die halfway and leave a
      // gym nobody can administer.
      if (patch.role === 'owner') {
        const { error } = await supabase.rpc('transfer_ownership', { p_to: membershipId })
        if (error) return 'failed'
      }
      const rest = defined({
        display_name: patch.displayName,
        status: patch.status,
        role: patch.role === 'owner' ? undefined : patch.role,
      })
      if (Object.keys(rest).length === 0) return 'saved'
      return direct(async () =>
        supabase.from('memberships').update(rest).eq('gym_id', gymId).eq('id', membershipId),
      )
    },

    async exportGym(gymId) {
      const [gym, members, athletes, exercises] = await Promise.all([
        repo.getGym(gymId),
        team(gymId),
        rows(await supabase.from('athletes').select(ATHLETE_COLS).eq('gym_id', gymId), toAthlete),
        rows(await supabase.from('exercises').select(EXERCISE_COLS).eq('gym_id', gymId), toExercise),
      ])
      const sessions = rows(
        await supabase.from('sessions').select(SESSION_COLS).eq('gym_id', gymId),
        toSession,
      )
      const [blocks, sets, notes, appointments] = await Promise.all([
        rows(await supabase.from('blocks').select(BLOCK_COLS).eq('gym_id', gymId), toBlock),
        rows(await supabase.from('sets').select(SET_COLS).eq('gym_id', gymId), toSet),
        rows(await supabase.from('notes').select(NOTE_COLS).eq('gym_id', gymId), toNote),
        rows(
          await supabase.from('appointments').select(APPOINTMENT_COLS).eq('gym_id', gymId),
          toAppointment,
        ),
      ])
      return JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          gym,
          memberships: members,
          athletes,
          exercises,
          sessions,
          blocks,
          sets,
          notes,
          appointments,
        },
        null,
        2,
      )
    },

    resetDemoData() {
      // Present so the contract is total, and refusing so nobody wires a "reset" button to a
      // real gym's three months of history. The Settings screen gates on `kind` instead.
      return Promise.reject(new Error('resetDemoData is local-only; the server owns this data'))
    },
  }

  return repo
}
