/**
 * The local repository: the whole app, against IndexedDB, with no server anywhere.
 *
 * This is what makes TrainHub judgeable on day zero. It is a real implementation of the same
 * contract `supabaseRepo` satisfies — same soft deletes, same `(position, id)` ordering, same
 * attribution on every number — so a screen written against it needs no change when a gym
 * owner finally creates a Supabase project.
 *
 * Two rules it does not bend:
 *
 *  1. **Every IndexedDB touch is guarded.** In private mode and under a "block all cookies"
 *     policy the accessor itself throws, not just the read. A demo that white-screens because
 *     a trainer opened it in a private tab has failed at the one job it has, so a throwing
 *     store degrades to an in-memory one and the app keeps working for the length of the tab.
 *  2. **One serialized read-modify-write chain.** The whole gym lives under a single key, so
 *     two concurrent writes that both loaded before either saved would lose one of them —
 *     which on this screen means the set a coach just typed.
 */

import { lastPerformance as lastPerformanceOf } from '@/domain/analytics'
import { formatSet } from '@/domain/format'
import { matches } from '@/domain/text'
import { newId } from '@/data/ids'
import { createIdbStorage, type OutboxStorage } from '@/data/outbox'
import { buildSeed, localDateIn, SEED_IDS, type SeedData } from '@/data/repo/seed'
import type {
  Block,
  Briefing,
  Exercise,
  Gym,
  Invite,
  LastPerformance,
  LocalDate,
  MemberRole,
  Note,
  Session,
  SessionTree,
  Timestamp,
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

/** Bumped only when the stored shape changes; an older record is discarded and re-seeded. */
const DB_VERSION = 1
const DB_KEY = 'trainhub:local:v1'

/** The exercise picker's first screen holds eight rows before it needs a scroll. */
const DEFAULT_RECENT_LIMIT = 8
/** The briefing's last-session summary. Three lines is what fits above the fold. */
const BRIEFING_TOP_LINES = 3

interface LocalDb extends SeedData {
  v: number
}

export interface LocalRepoOptions {
  /** Injected by tests so no IndexedDB is needed. */
  storage?: OutboxStorage
  /** Fixed demo data, for a deterministic test. */
  seed?: SeedData
  /** Who the demo is signed in as. Everything written locally is attributed to them. */
  actingMembershipId?: Uuid
  now?: () => Date
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

interface Deletable {
  deletedAt: Timestamp | null
}

function live<T extends Deletable>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.deletedAt === null)
}

/**
 * `(position, id)` — never `position` alone. Two offline inserts can mint the same position,
 * and the id is a UUIDv7 whose string order is creation order, so both devices agree.
 */
function byPosition(a: { position: number; id: Uuid }, b: { position: number; id: Uuid }): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Total order over sessions: gym day, then instant, then id. */
function compareSessions(a: Session, b: Session): number {
  if (a.localDate !== b.localDate) return a.localDate < b.localDate ? -1 : 1
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function exerciseName(exercise: Exercise | undefined): string | null {
  if (!exercise) return null
  return exercise.nameEl ?? exercise.nameEn ?? null
}

interface Measurable {
  loadKg?: number | null
  reps?: number | null
  seconds?: number | null
  meters?: number | null
}

/** Does this set carry a number yet? `doneAt` follows from it, never the other way round. */
function hasMeasurement(input: Measurable): boolean {
  return [input.loadKg, input.reps, input.seconds, input.meters].some(
    (value) => value !== null && value !== undefined,
  )
}

/**
 * Any store, made unable to break the app.
 *
 * `createIdbStorage()` already guards idb-keyval, but this wraps whatever it is given — an
 * injected store in a test, a future one — because the rule is about the app's behaviour, not
 * about one library: in private mode and under a "block all cookies" policy the accessor
 * itself throws, and a demo that white-screens for that reason has failed at its only job.
 *
 * Once a write has failed, reads prefer memory. Otherwise a store that can be read but not
 * written would keep serving the version from before the coach's last four sets.
 */
function resilient(storage: OutboxStorage): OutboxStorage {
  const memory = new Map<string, unknown>()
  let degraded = false
  return {
    async get<T>(key: string): Promise<T | undefined> {
      if (!degraded) {
        try {
          const value = await storage.get<T>(key)
          if (value !== undefined) return value
        } catch {
          degraded = true
        }
      }
      return memory.get(key) as T | undefined
    },
    async set(key: string, value: unknown): Promise<void> {
      memory.set(key, value)
      try {
        await storage.set(key, value)
      } catch {
        degraded = true
      }
    },
    async del(key: string): Promise<void> {
      memory.delete(key)
      try {
        await storage.del(key)
      } catch {
        degraded = true
      }
    },
  }
}

// ---------------------------------------------------------------------------

export function createLocalRepo(options: LocalRepoOptions = {}): Repo {
  const storage = resilient(options.storage ?? createIdbStorage())
  const now = options.now ?? (() => new Date())
  const acting = options.actingMembershipId ?? SEED_IDS.owner
  const makeSeed = (): SeedData => options.seed ?? buildSeed()

  // Every load/save pair runs on this chain. Without it, "add set" and "rename session"
  // fired half a millisecond apart both read the pre-edit gym and the second save wins.
  let chain: Promise<unknown> = Promise.resolve()

  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task)
    // Swallowed on the chain only — `run` still rejects for its caller. Otherwise one failed
    // write would poison every later one.
    chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async function load(): Promise<LocalDb> {
    const stored = await storage.get<LocalDb>(DB_KEY)
    if (stored && stored.v === DB_VERSION && stored.gym) return stored
    const fresh: LocalDb = { v: DB_VERSION, ...makeSeed() }
    await storage.set(DB_KEY, fresh)
    return fresh
  }

  async function save(db: LocalDb): Promise<void> {
    await storage.set(DB_KEY, db)
  }

  /** A read. Serialized too, so it never observes a half-applied write. */
  function read<T>(fn: (db: LocalDb) => T): Promise<T> {
    return serialize(async () => fn(await load()))
  }

  /**
   * A write. `fn` returns false when it found nothing to change — a delete of a row that is
   * already gone, say — which is reported as `failed` rather than a silent success the UI
   * would render as saved.
   */
  function write(gymId: Uuid, fn: (db: LocalDb, at: Timestamp) => boolean | void): Promise<WriteState> {
    return serialize(async () => {
      const db = await load()
      if (db.gym.id !== gymId) return 'failed'
      const at = now().toISOString()
      const result = fn(db, at)
      if (result === false) return 'failed'
      await save(db)
      return 'saved'
    })
  }

  function touch<T extends { updatedAt: Timestamp }>(row: T, at: Timestamp): T {
    row.updatedAt = at
    return row
  }

  function gymOf(db: LocalDb, gymId: Uuid): Gym | null {
    return db.gym.id === gymId && db.gym.deletedAt === null ? db.gym : null
  }

  function memberName(db: LocalDb, membershipId: Uuid | null): string | null {
    if (!membershipId) return null
    return db.memberships.find((m) => m.id === membershipId)?.displayName ?? null
  }

  function athleteSessionsDesc(db: LocalDb, athleteId: Uuid): Session[] {
    return live(db.sessions)
      .filter((s) => s.athleteId === athleteId)
      .sort((a, b) => compareSessions(b, a))
  }

  function blocksOf(db: LocalDb, sessionId: Uuid): Block[] {
    return live(db.blocks)
      .filter((b) => b.sessionId === sessionId)
      .sort(byPosition)
  }

  function setsOf(db: LocalDb, blockId: Uuid): WorkoutSet[] {
    return live(db.sets)
      .filter((s) => s.blockId === blockId)
      .sort(byPosition)
  }

  function localDateNow(db: LocalDb, at: Date = now()): LocalDate {
    return localDateIn(db.gym.timezone, at)
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  const repo: Repo = {
    kind: 'local',

    getGym: (gymId) => read((db) => gymOf(db, gymId)),

    listTeam: (gymId) =>
      read((db) =>
        gymOf(db, gymId)
          ? live(db.memberships)
              .filter((m) => m.status !== 'removed')
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          : [],
      ),

    listInvites: (gymId) =>
      read((db) =>
        gymOf(db, gymId)
          ? db.invites
              .filter((i) => i.revokedAt === null && i.acceptedAt === null)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          : [],
      ),

    listAthletes: (gymId, search) =>
      read((db) => {
        if (!gymOf(db, gymId)) return []
        const rows = live(db.athletes)
        const found = search ? rows.filter((a) => matches(a.fullName, search)) : rows
        // Diacritic- and case-insensitive, so "παπ" finds "Παπαδόπουλος" on a phone keyboard.
        return found.sort((a, b) => a.fullName.localeCompare(b.fullName, 'el'))
      }),

    getAthlete: (gymId, athleteId) =>
      read((db) =>
        gymOf(db, gymId)
          ? (live(db.athletes).find((a) => a.id === athleteId) ?? null)
          : null,
      ),

    getBriefing: (gymId, athleteId) =>
      read((db) => {
        if (!gymOf(db, gymId)) return null
        const athlete = live(db.athletes).find((a) => a.id === athleteId)
        if (!athlete) return null

        const withAuthor = (note: Note): Note & { authorName: string | null } => ({
          ...note,
          authorName: memberName(db, note.author),
        })

        const notes = db.notes
          .filter((n) => n.athleteId === athleteId && n.dismissedAt === null)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

        const last = athleteSessionsDesc(db, athleteId)[0] ?? null
        const lastSession: Briefing['lastSession'] = last
          ? {
              id: last.id,
              localDate: last.localDate,
              title: last.title,
              authorName: memberName(db, last.creditedTo ?? last.loggedBy),
              topLines: briefingTopLines(
                blocksOf(db, last.id),
                live(db.sets),
                db.exercises,
              ),
            }
          : null

        return {
          athlete,
          coachName: memberName(db, athlete.coachMembershipId),
          pinnedNotes: notes.filter((n) => n.pinned).map(withAuthor),
          // The latest note whether pinned or not: a pinned warning is standing context, and
          // "what happened last time" is usually the newest line on the sheet.
          latestNote: notes[0] ? withAuthor(notes[0]) : null,
          lastSession,
        }
      }),

    listAthleteSessions: (gymId, athleteId) =>
      read((db) => (gymOf(db, gymId) ? athleteSessionsDesc(db, athleteId) : [])),

    listNotes: (gymId, athleteId) =>
      read((db) =>
        gymOf(db, gymId)
          ? db.notes
              // Dismissed notes stay in the list, faded rather than gone: they are the
              // attribution trail, and a note that vanishes is a note a colleague cannot
              // find out was ever written.
              .filter((n) => n.athleteId === athleteId)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((n) => ({ ...n, authorName: memberName(db, n.author) }))
          : [],
      ),

    getProgressData: (gymId, athleteId) =>
      read((db): ProgressData => {
        if (!gymOf(db, gymId)) return { sessions: [], sets: [], blocks: [], exercises: [] }
        const sessions = live(db.sessions).filter((s) => s.athleteId === athleteId)
        const sessionIds = new Set(sessions.map((s) => s.id))
        const blocks = live(db.blocks).filter((b) => sessionIds.has(b.sessionId))
        const blockIds = new Set(blocks.map((b) => b.id))
        return {
          sessions,
          blocks: blocks.map((b) => ({
            id: b.id,
            sessionId: b.sessionId,
            exerciseId: b.exerciseId,
            position: b.position,
            deletedAt: b.deletedAt,
          })),
          sets: live(db.sets).filter((s) => blockIds.has(s.blockId)),
          exercises: live(db.exercises),
        }
      }),

    getSessionTree: (gymId, sessionId) =>
      read((db): SessionTree | null => {
        if (!gymOf(db, gymId)) return null
        const session = live(db.sessions).find((s) => s.id === sessionId)
        if (!session) return null
        return {
          ...session,
          blocks: blocksOf(db, sessionId).map((block) => ({ ...block, sets: setsOf(db, block.id) })),
        }
      }),

    listExercises: (gymId) =>
      read((db) =>
        live(db.exercises)
          // The shared catalogue (`gymId === null`) plus this gym's own additions.
          .filter((e) => (e.gymId === null || e.gymId === gymId) && e.mergedIntoId === null)
          .sort((a, b) => (a.nameEl ?? a.nameEn ?? '').localeCompare(b.nameEl ?? b.nameEn ?? '', 'el')),
      ),

    listRecentExercises: (gymId, athleteId, limit = DEFAULT_RECENT_LIMIT) =>
      read((db) => {
        if (!gymOf(db, gymId)) return []
        const byId = new Map(db.exercises.map((e) => [e.id, e]))
        const mine = recentFor(db, athleteId, limit, byId)
        // A brand-new athlete has no history, and the first session with a client is exactly
        // when a coach is most distracted. The gym's own habits are a better guess than an
        // empty list — and far better than making them search.
        return mine.length > 0 ? mine : mostLoggedInGym(db, limit, byId)
      }),

    getLastPerformance: (gymId, athleteId, exerciseId, excludeSessionId) =>
      read((db): LastPerformance | null => {
        if (!gymOf(db, gymId)) return null
        return lastPerformanceOf(
          {
            sessions: live(db.sessions),
            blocks: live(db.blocks),
            sets: live(db.sets),
            exercises: db.exercises,
            // Passed so the answer carries a name: "80×8 · 12 Αυγ · Μαρία". A coaching number
            // without its author is worse than none, because someone loads a bar with it.
            memberships: db.memberships,
          },
          athleteId,
          exerciseId,
          excludeSessionId ?? null,
        )
      }),

    listAppointments: (gymId, from, to) =>
      read((db) =>
        gymOf(db, gymId)
          ? live(db.appointments)
              .filter((a) => a.date >= from && a.date <= to)
              .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
          : [],
      ),

    // -----------------------------------------------------------------------
    // Writes
    // -----------------------------------------------------------------------

    createSession: (gymId, input: NewSessionInput) =>
      write(gymId, (db, at) => {
        if (!live(db.athletes).some((a) => a.id === input.athleteId)) return false
        const startedAt = input.startedAt ?? at
        db.sessions.push({
          id: input.id,
          gymId,
          athleteId: input.athleteId,
          // Server-stamped on Supabase; here the demo identity is the only writer there is.
          loggedBy: acting,
          creditedTo: null,
          appointmentId: null,
          title: input.title ?? null,
          notes: null,
          status: 'active',
          startedAt,
          finishedAt: null,
          // The gym's day, not a UTC slice: a 01:00 session in Athens is still that evening's.
          localDate: localDateNow(db, new Date(startedAt)),
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
          createdBy: acting,
        })
      }),

    updateSession: (gymId, sessionId, patch) =>
      write(gymId, (db, at) => {
        const session = live(db.sessions).find((s) => s.id === sessionId)
        if (!session) return false
        Object.assign(session, patch)
        touch(session, at)
      }),

    finishSession: (gymId, sessionId) =>
      write(gymId, (db, at) => {
        const session = live(db.sessions).find((s) => s.id === sessionId)
        if (!session) return false
        session.status = 'finished'
        session.finishedAt = at
        touch(session, at)
      }),

    deleteSession: (gymId, sessionId) =>
      write(gymId, (db, at) => {
        const session = live(db.sessions).find((s) => s.id === sessionId)
        if (!session) return false
        // Only the session is tombstoned. Its blocks and sets are reached through it, so undo
        // is one field back — cascading the delete would make the undo a multi-row replay
        // that can half-fail.
        session.deletedAt = at
        touch(session, at)
      }),

    addBlock: (gymId, sessionId, blockId, exerciseId, position) =>
      write(gymId, (db, at) => {
        if (!live(db.sessions).some((s) => s.id === sessionId)) return false
        db.blocks.push({
          id: blockId,
          gymId,
          sessionId,
          exerciseId,
          position,
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
          createdBy: acting,
        })
      }),

    setBlockExercise: (gymId, blockId, exerciseId) =>
      write(gymId, (db, at) => {
        const block = live(db.blocks).find((b) => b.id === blockId)
        if (!block) return false
        block.exerciseId = exerciseId
        touch(block, at)
      }),

    deleteBlock: (gymId, blockId) =>
      write(gymId, (db, at) => {
        const block = live(db.blocks).find((b) => b.id === blockId)
        if (!block) return false
        block.deletedAt = at
        touch(block, at)
      }),

    addSet: (gymId, input: NewSetInput) =>
      write(gymId, (db, at) => {
        if (!live(db.blocks).some((b) => b.id === input.blockId)) return false
        db.sets.push({
          id: input.id,
          gymId,
          blockId: input.blockId,
          position: input.position,
          kind: input.kind,
          targetKg: null,
          targetReps: null,
          loadKg: input.loadKg ?? null,
          reps: input.reps ?? null,
          seconds: input.seconds ?? null,
          meters: input.meters ?? null,
          rpe: input.rpe ?? null,
          note: null,
          // Sessions are logged AFTER the fact, so a set that already carries numbers was
          // performed. Leaving `doneAt` null would zero it out of every total.
          doneAt: hasMeasurement(input) ? at : null,
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
          createdBy: acting,
        })
      }),

    updateSet: (gymId, setId, patch) =>
      write(gymId, (db, at) => {
        const row = live(db.sets).find((s) => s.id === setId)
        if (!row) return false
        Object.assign(row, patch)
        if (row.doneAt === null && hasMeasurement(row)) row.doneAt = at
        touch(row, at)
      }),

    deleteSet: (gymId, setId) =>
      write(gymId, (db, at) => {
        const row = live(db.sets).find((s) => s.id === setId)
        if (!row) return false
        row.deletedAt = at
        touch(row, at)
      }),

    restoreSet: (gymId, setId) =>
      write(gymId, (db, at) => {
        const row = db.sets.find((s) => s.id === setId)
        if (!row) return false
        // Undo, not a new row: the set keeps its id, its position and its author.
        row.deletedAt = null
        touch(row, at)
      }),

    createAthlete: (gymId, athleteId, fullName) =>
      write(gymId, (db, at) => {
        const name = fullName.trim()
        if (name === '') return false
        db.athletes.push({
          id: athleteId,
          gymId,
          fullName: name,
          coachMembershipId: acting,
          planPhase: null,
          planFocus: null,
          birthDate: null,
          phone: null,
          email: null,
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
          createdBy: acting,
        })
      }),

    updateAthlete: (gymId, athleteId, patch) =>
      write(gymId, (db, at) => {
        const athlete = live(db.athletes).find((a) => a.id === athleteId)
        if (!athlete) return false
        Object.assign(athlete, patch)
        touch(athlete, at)
      }),

    archiveAthlete: (gymId, athleteId) =>
      write(gymId, (db, at) => {
        const athlete = live(db.athletes).find((a) => a.id === athleteId)
        if (!athlete) return false
        athlete.deletedAt = at
        touch(athlete, at)
      }),

    createExercise: (gymId, input: NewExerciseInput) =>
      write(gymId, (db, at) => {
        const nameEl = input.nameEl.trim()
        if (nameEl === '') return false
        db.exercises.push({
          id: input.id,
          // Non-null: this is the gym's own addition, not an edit to the shared catalogue.
          gymId,
          nameEl,
          nameEn: input.nameEn ?? null,
          category: input.category,
          equipment: input.equipment,
          defaultSetKind: input.defaultSetKind ?? 'weight_reps',
          defaultRestS: 90,
          mergedIntoId: null,
          isArchived: false,
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
          createdBy: acting,
        })
      }),

    archiveExercise: (gymId, exerciseId) =>
      write(gymId, (db, at) => {
        const exercise = live(db.exercises).find((e) => e.id === exerciseId)
        // Archived, never deleted: historical blocks point at this row and a tombstone would
        // leave three months of sessions naming an exercise nobody can resolve.
        if (!exercise || exercise.gymId === null) return false
        exercise.isArchived = true
        touch(exercise, at)
      }),

    addNote: (gymId, noteId, athleteId, body, opts) =>
      write(gymId, (db, at) => {
        const text = body.trim()
        if (text === '') return false
        db.notes.push({
          id: noteId,
          gymId,
          athleteId,
          sessionId: opts?.sessionId ?? null,
          body: text,
          pinned: opts?.pinned ?? false,
          author: acting,
          createdAt: at,
          dismissedAt: null,
          dismissedBy: null,
        })
      }),

    setNotePinned: (gymId, noteId, pinned) =>
      write(gymId, (db) => {
        const note = db.notes.find((n) => n.id === noteId)
        if (!note) return false
        // `pinned` is the one mutable field on a note. `body` is append-only — a correction
        // is a new note — which is what keeps notes safe under last-write-wins.
        note.pinned = pinned
      }),

    dismissNote: (gymId, noteId) =>
      write(gymId, (db, at) => {
        const note = db.notes.find((n) => n.id === noteId)
        if (!note) return false
        note.dismissedAt = at
        note.dismissedBy = acting
      }),

    createAppointment: (gymId, input: NewAppointmentInput) =>
      write(gymId, (db, at) => {
        if (!live(db.athletes).some((a) => a.id === input.athleteId)) return false
        db.appointments.push({
          id: input.id,
          gymId,
          athleteId: input.athleteId,
          membershipId: input.membershipId,
          date: input.date,
          time: input.time,
          durationMin: input.durationMin ?? 60,
          type: input.type,
          notes: input.notes ?? null,
          status: 'scheduled',
          sessionId: null,
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
          createdBy: acting,
        })
      }),

    updateAppointment: (gymId, appointmentId, patch) =>
      write(gymId, (db, at) => {
        const appointment = live(db.appointments).find((a) => a.id === appointmentId)
        if (!appointment) return false
        Object.assign(appointment, patch)
        touch(appointment, at)
      }),

    deleteAppointment: (gymId, appointmentId) =>
      write(gymId, (db, at) => {
        const appointment = live(db.appointments).find((a) => a.id === appointmentId)
        if (!appointment) return false
        appointment.deletedAt = at
        touch(appointment, at)
      }),

    updateGym: (gymId, patch) =>
      write(gymId, (db, at) => {
        Object.assign(db.gym, patch)
        touch(db.gym, at)
      }),

    inviteTrainer: (gymId, email, role: MemberRole) =>
      serialize(async (): Promise<{ state: WriteState; secret?: string }> => {
        const db = await load()
        if (db.gym.id !== gymId) return { state: 'failed' }
        const address = email.trim().toLowerCase()
        if (address === '') return { state: 'failed' }
        const at = now().toISOString()
        // Mirrors create_invite(): the secret exists exactly once, in this response, and is
        // never stored — so nothing here can hand it back a second time either.
        const secret = newId().replace(/-/g, '')
        const invite: Invite = {
          id: newId(),
          gymId,
          email: address,
          role,
          expiresAt: new Date(now().getTime() + 14 * 24 * 60 * 60_000).toISOString(),
          maxUses: 1,
          uses: 0,
          revokedAt: null,
          acceptedAt: null,
          acceptedBy: null,
          createdAt: at,
        }
        db.invites.push(invite)
        await save(db)
        return { state: 'saved', secret }
      }),

    revokeInvite: (gymId, inviteId) =>
      write(gymId, (db, at) => {
        const invite = db.invites.find((i) => i.id === inviteId)
        if (!invite) return false
        invite.revokedAt = at
      }),

    updateMember: (gymId, membershipId, patch) =>
      write(gymId, (db, at) => {
        const member = live(db.memberships).find((m) => m.id === membershipId)
        if (!member) return false
        // A gym with no owner cannot be administered by anyone, ever again.
        const owners = live(db.memberships).filter((m) => m.role === 'owner' && m.status === 'active')
        const losingLastOwner =
          member.role === 'owner' &&
          owners.length === 1 &&
          (patch.role === 'trainer' || (patch.status !== undefined && patch.status !== 'active'))
        if (losingLastOwner) return false
        Object.assign(member, patch)
        touch(member, at)
      }),

    exportGym: (gymId) =>
      read((db) =>
        JSON.stringify(
          db.gym.id === gymId
            ? {
                exportedAt: now().toISOString(),
                gym: db.gym,
                memberships: db.memberships,
                athletes: db.athletes,
                // The gym's own exercises only: the shared catalogue is not this gym's data.
                exercises: db.exercises.filter((e) => e.gymId === gymId),
                sessions: db.sessions,
                blocks: db.blocks,
                sets: db.sets,
                notes: db.notes,
                appointments: db.appointments,
              }
            : {},
          null,
          2,
        ),
      ),

    resetDemoData: () =>
      serialize(async () => {
        await save({ v: DB_VERSION, ...makeSeed() })
      }),
  }

  return repo
}

// ---------------------------------------------------------------------------
// Recent exercises
// ---------------------------------------------------------------------------

function recentFor(
  db: LocalDb,
  athleteId: Uuid,
  limit: number,
  byId: Map<Uuid, Exercise>,
): RecentExercise[] {
  const seen = new Map<Uuid, { lastUsed: LocalDate; sessions: Set<Uuid> }>()
  const liveBlocks = live(db.blocks)

  // Newest session first, so insertion order IS recency order and no second sort can
  // disagree with it.
  for (const session of live(db.sessions)
    .filter((s) => s.athleteId === athleteId)
    .sort((a, b) => compareSessions(b, a))) {
    for (const block of liveBlocks.filter((b) => b.sessionId === session.id)) {
      const entry = seen.get(block.exerciseId)
      if (entry) entry.sessions.add(session.id)
      // One block per session counted once: a superset that repeats an exercise twice in one
      // session is not twice the habit.
      else seen.set(block.exerciseId, { lastUsed: session.localDate, sessions: new Set([session.id]) })
    }
  }

  const rows: RecentExercise[] = []
  for (const [exerciseId, entry] of seen) {
    const exercise = byId.get(exerciseId)
    if (!exercise || exercise.deletedAt !== null) continue
    rows.push({ exercise, lastUsed: entry.lastUsed, timesUsed: entry.sessions.size })
    if (rows.length === limit) break
  }
  return rows
}

function mostLoggedInGym(db: LocalDb, limit: number, byId: Map<Uuid, Exercise>): RecentExercise[] {
  const tally = new Map<Uuid, { lastUsed: LocalDate; sessions: Set<Uuid> }>()
  const sessionById = new Map(live(db.sessions).map((s) => [s.id, s]))

  for (const block of live(db.blocks)) {
    const session = sessionById.get(block.sessionId)
    if (!session) continue
    const entry = tally.get(block.exerciseId)
    if (!entry) {
      tally.set(block.exerciseId, { lastUsed: session.localDate, sessions: new Set([session.id]) })
      continue
    }
    entry.sessions.add(session.id)
    if (session.localDate > entry.lastUsed) entry.lastUsed = session.localDate
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
      if (!exercise || exercise.deletedAt !== null) return []
      return [{ exercise, lastUsed: entry.lastUsed, timesUsed: entry.sessions.size }]
    })
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// The briefing's last-session summary
// ---------------------------------------------------------------------------

/**
 * "Πιέσεις Στήθους · 72,5×5" — the top set of each of a session's first few blocks.
 *
 * Rendered in Greek because Greek is the default locale, and assembled here rather than in a
 * screen so both repositories produce the identical briefing. It is never shown without the
 * session's date and author: the Briefing Card puts "12 Αυγ · Μαρία" on the same card, which
 * is the whole contract around a coaching number.
 *
 * Exported because `supabaseRepo` builds the same three lines from its own rows.
 */
export function briefingTopLines(
  blocks: readonly Block[],
  sets: readonly WorkoutSet[],
  exercises: readonly Exercise[],
  limit: number = BRIEFING_TOP_LINES,
): string[] {
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const lines: string[] = []

  for (const block of [...blocks].sort(byPosition)) {
    const performed = sets.filter((s) => s.blockId === block.id)
    if (performed.length === 0) continue
    const name = exerciseName(byId.get(block.exerciseId))
    if (!name) continue

    const kind = performed[0].kind
    let top = performed[0]
    for (const candidate of performed) if (scoreOf(candidate) > scoreOf(top)) top = candidate
    lines.push(`${name} · ${formatSet(top, kind, 'el')}`)
    if (lines.length === limit) break
  }

  return lines
}

/** A single comparable magnitude per set, so "the top one" means something for every kind. */
function scoreOf(set: WorkoutSet): number {
  return set.loadKg ?? set.meters ?? set.seconds ?? set.reps ?? 0
}
