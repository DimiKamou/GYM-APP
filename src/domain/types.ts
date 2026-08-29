/**
 * TrainHub domain types.
 *
 * These mirror `supabase/migrations/001_init.sql` exactly. When the schema changes,
 * this file changes in the same commit — it is the contract every other module imports.
 *
 * Three shapes deliberately differ from the design prototype (see the build plan):
 *  1. A set is a ROW, not a leaf of a nested session document. The smallest write is one
 *     set, so two coaches appending to the same session merge as a union.
 *  2. `gymId` is on every entity. It cannot be added once real history exists.
 *  3. Authorship is two fields: `loggedBy` (server-stamped, immutable) and `creditedTo`
 *     (editable). One field alone cannot represent both "who typed this" and "whose
 *     session it was", and the workaround for that is a shared login.
 */

/** UUIDv7 — client-minted, so an offline insert needs no round-trip. */
export type Uuid = string
/** `YYYY-MM-DD`, always the gym's local date (never a UTC slice of an instant). */
export type LocalDate = string
/** ISO-8601 instant. */
export type Timestamp = string

export type MemberRole = 'owner' | 'trainer'
export type MemberStatus = 'invited' | 'active' | 'removed'

/**
 * What a set actually measures. The prototype stored 20 treadmill minutes and 10
 * pull-ups identically as `{kg: 0, reps: N}`, so every volume total silently counted
 * both as zero.
 */
export type SetKind = 'weight_reps' | 'bodyweight' | 'duration' | 'distance'
export type SessionStatus = 'active' | 'finished'

export type ExerciseCategory = 'upper' | 'lower' | 'core' | 'cardio' | 'mobility'
export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'bodyweight'
  | 'cardio'
  | 'kettlebell'
  | 'other'

/** Columns every table carries. Reads always filter `deletedAt === null`. */
export interface Auditable {
  createdAt: Timestamp
  updatedAt: Timestamp
  /** Soft delete. A hard delete is invisible to sync and the row resurrects. */
  deletedAt: Timestamp | null
  createdBy: Uuid | null
}

export interface Gym extends Auditable {
  id: Uuid
  name: string
  /** IANA zone. Drives `Session.localDate`; never inferred from the device. */
  timezone: string
  displayUnit: 'kg' | 'lb'
}

export interface Membership extends Auditable {
  id: Uuid
  gymId: Uuid
  /** `auth.users.id`. Null while an invite is outstanding. */
  userId: Uuid | null
  displayName: string
  email: string
  role: MemberRole
  status: MemberStatus
}

export interface Athlete extends Auditable {
  id: Uuid
  gymId: Uuid
  fullName: string
  /** Soft ownership — a filter and a reporting dimension, never an access fence. */
  coachMembershipId: Uuid | null
  /** "Δύναμη, εβδ. 3/6" — one line of prose, not a template engine. */
  planPhase: string | null
  planFocus: string | null
  birthDate: LocalDate | null
  phone: string | null
  email: string | null
}

export interface Exercise extends Auditable {
  id: Uuid
  /** `null` = the shared bilingual catalogue. Non-null = this gym's own addition. */
  gymId: Uuid | null
  nameEl: string | null
  nameEn: string | null
  category: ExerciseCategory
  equipment: Equipment
  defaultSetKind: SetKind
  defaultRestS: number
  /** Fold a duplicate into the canonical row without orphaning historical blocks. */
  mergedIntoId: Uuid | null
  isArchived: boolean
}

export interface ExerciseAlias {
  id: Uuid
  exerciseId: Uuid
  gymId: Uuid | null
  /** Lowercased, diacritic-stripped. Two coaches genuinely call one machine two things. */
  normAlias: string
}

export interface Session extends Auditable {
  id: Uuid
  gymId: Uuid
  athleteId: Uuid
  /** Stamped by a BEFORE INSERT trigger from `auth.uid()`. Never writable by a client. */
  loggedBy: Uuid
  /** Editable, defaults to `loggedBy`. Every change writes a `session_events` row. */
  creditedTo: Uuid | null
  appointmentId: Uuid | null
  title: string | null
  notes: string | null
  status: SessionStatus
  startedAt: Timestamp
  finishedAt: Timestamp | null
  /** Trigger-derived: `(startedAt at time zone gym.timezone)::date`. */
  localDate: LocalDate
}

export interface Block extends Auditable {
  id: Uuid
  gymId: Uuid
  sessionId: Uuid
  exerciseId: Uuid
  /** Sort by `(position, id)` — two offline inserts can mint the same position. */
  position: number
}

export interface WorkoutSet extends Auditable {
  id: Uuid
  gymId: Uuid
  blockId: Uuid
  position: number
  kind: SetKind
  /** The plan. Populated only if this gym pre-writes workouts. */
  targetKg: number | null
  targetReps: number | null
  /** The performance. Canonical units are kg and metres. */
  loadKg: number | null
  reps: number | null
  seconds: number | null
  meters: number | null
  rpe: number | null
  note: string | null
  /** `null` means prescribed but not yet performed — not "missed". */
  doneAt: Timestamp | null
}

/**
 * Append-only. There is no UPDATE policy on `body`, which is what makes notes safe
 * under last-write-wins: otherwise a trainer holding a three-week-old athlete row
 * republishes stale notes over a colleague's addition.
 */
export interface Note {
  id: Uuid
  gymId: Uuid
  athleteId: Uuid
  sessionId: Uuid | null
  body: string
  /** Pinned notes render on the Briefing Card and in the Log screen header. */
  pinned: boolean
  author: Uuid
  createdAt: Timestamp
  dismissedAt: Timestamp | null
  dismissedBy: Uuid | null
}

export interface Invite {
  id: Uuid
  gymId: Uuid
  email: string | null
  role: MemberRole
  expiresAt: Timestamp
  maxUses: number
  uses: number
  revokedAt: Timestamp | null
  acceptedAt: Timestamp | null
  acceptedBy: Uuid | null
  createdAt: Timestamp
  /** Present exactly once, in the response that mints it. Never stored, never re-readable. */
  secret?: string
}

export type AppointmentType = 'personal' | 'assessment' | 'group' | 'program'
export type AppointmentStatus = 'scheduled' | 'done'

export interface Appointment extends Auditable {
  id: Uuid
  gymId: Uuid
  athleteId: Uuid
  membershipId: Uuid | null
  date: LocalDate
  /** `HH:mm`, in the gym's timezone. */
  time: string
  durationMin: number
  type: AppointmentType
  notes: string | null
  status: AppointmentStatus
  /** Set when "Start session" creates a log from this appointment. */
  sessionId: Uuid | null
}

// ---------------------------------------------------------------------------
// Read models — what screens actually consume.
// ---------------------------------------------------------------------------

/** A session with its blocks and sets rehydrated, for the Log screen. */
export interface SessionTree extends Session {
  blocks: Array<Block & { sets: WorkoutSet[] }>
}

/**
 * The previous top set for one exercise. Always rendered WITH its date and author —
 * a coaching number without provenance is worse than no number, because the coach
 * loads a bar with it.
 */
export interface LastPerformance {
  kind: SetKind
  loadKg: number | null
  reps: number | null
  seconds: number | null
  meters: number | null
  date: LocalDate
  authorName: string | null
}

/** Everything the Briefing Card needs above the fold. */
export interface Briefing {
  athlete: Athlete
  coachName: string | null
  pinnedNotes: Array<Note & { authorName: string | null }>
  latestNote: (Note & { authorName: string | null }) | null
  lastSession: {
    id: Uuid
    localDate: LocalDate
    title: string | null
    authorName: string | null
    topLines: string[]
  } | null
}
