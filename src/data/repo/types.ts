/**
 * The repository contract.
 *
 * Two implementations satisfy it: `supabaseRepo` talks to PostgREST and queues its writes
 * through the outbox, and `localRepo` keeps everything in IndexedDB against seeded demo data.
 * The screens never know which one they have.
 *
 * That seam is not a testing convenience. Until the gym owner creates the Supabase project
 * there is no server to talk to, and an app that cannot be opened cannot be judged — a trainer
 * deciding whether this beats their clipboard has to be able to hold it. The local repo is how
 * the whole product is clickable on day zero.
 *
 * Every read filters `deletedAt`. Every write is expressed as an intent the outbox can replay,
 * so nothing here returns a server-generated id: ids are minted client-side (UUIDv7) and the
 * caller already knows them.
 */

import type {
  Appointment,
  AppointmentType,
  Athlete,
  Briefing,
  Exercise,
  ExerciseCategory,
  Gym,
  Invite,
  LastPerformance,
  LocalDate,
  Membership,
  MemberRole,
  Note,
  Session,
  SessionTree,
  SetKind,
  Uuid,
  WorkoutSet,
} from '@/domain/types'

/** One row of the exercise picker's "this athlete, recently" list. */
export interface RecentExercise {
  exercise: Exercise
  lastUsed: LocalDate
  timesUsed: number
}

/** What the Progress section needs; the pure functions in `@/domain/analytics` do the maths. */
export interface ProgressData {
  sessions: Session[]
  sets: WorkoutSet[]
  blocks: Array<{ id: Uuid; sessionId: Uuid; exerciseId: Uuid; position: number; deletedAt: string | null }>
  exercises: Exercise[]
}

export interface NewSessionInput {
  id: Uuid
  athleteId: Uuid
  title?: string | null
  /** Omitted means now. Supplied when a coach logs yesterday's session from the desk. */
  startedAt?: string
}

export interface NewSetInput {
  id: Uuid
  blockId: Uuid
  kind: SetKind
  position: number
  loadKg?: number | null
  reps?: number | null
  seconds?: number | null
  meters?: number | null
  rpe?: number | null
}

export interface NewExerciseInput {
  id: Uuid
  /** Greek is required; English is the courtesy. The prototype had this the other way round. */
  nameEl: string
  nameEn?: string | null
  category: ExerciseCategory
  equipment: Exercise['equipment']
  defaultSetKind?: SetKind
}

export interface NewAppointmentInput {
  id: Uuid
  athleteId: Uuid
  membershipId: Uuid | null
  date: LocalDate
  time: string
  durationMin?: number
  type: AppointmentType
  notes?: string | null
}

/**
 * How a write reached the server, surfaced so the UI can be honest rather than optimistic.
 * `queued` is the normal offline state and is not an error.
 */
export type WriteState = 'saved' | 'queued' | 'failed'

export interface Repo {
  /** Which implementation is live. The Settings screen says so out loud. */
  readonly kind: 'supabase' | 'local'

  // ---- reads ----
  getGym(gymId: Uuid): Promise<Gym | null>
  listTeam(gymId: Uuid): Promise<Membership[]>
  listInvites(gymId: Uuid): Promise<Invite[]>

  listAthletes(gymId: Uuid, search?: string): Promise<Athlete[]>
  getAthlete(gymId: Uuid, athleteId: Uuid): Promise<Athlete | null>
  /** The five-second read: pinned warnings, the latest note, and the last session in one line. */
  getBriefing(gymId: Uuid, athleteId: Uuid): Promise<Briefing | null>
  listAthleteSessions(gymId: Uuid, athleteId: Uuid): Promise<Session[]>
  listNotes(gymId: Uuid, athleteId: Uuid): Promise<Array<Note & { authorName: string | null }>>
  getProgressData(gymId: Uuid, athleteId: Uuid): Promise<ProgressData>

  getSessionTree(gymId: Uuid, sessionId: Uuid): Promise<SessionTree | null>

  listExercises(gymId: Uuid): Promise<Exercise[]>
  /**
   * The picker's first screen. Personal training is repetitive, so the eight exercises this
   * athlete did most recently beat any search box. Falls back to the gym's most-logged when
   * an athlete is brand new — the first session with a client is when a coach is most distracted.
   */
  listRecentExercises(gymId: Uuid, athleteId: Uuid, limit?: number): Promise<RecentExercise[]>
  /** Never rendered without its date and author. */
  getLastPerformance(
    gymId: Uuid,
    athleteId: Uuid,
    exerciseId: Uuid,
    excludeSessionId?: Uuid,
  ): Promise<LastPerformance | null>

  listAppointments(gymId: Uuid, from: LocalDate, to: LocalDate): Promise<Appointment[]>

  // ---- writes ----
  createSession(gymId: Uuid, input: NewSessionInput): Promise<WriteState>
  updateSession(gymId: Uuid, sessionId: Uuid, patch: Partial<Pick<Session, 'title' | 'notes' | 'creditedTo' | 'localDate'>>): Promise<WriteState>
  finishSession(gymId: Uuid, sessionId: Uuid): Promise<WriteState>
  deleteSession(gymId: Uuid, sessionId: Uuid): Promise<WriteState>

  addBlock(gymId: Uuid, sessionId: Uuid, blockId: Uuid, exerciseId: Uuid, position: number): Promise<WriteState>
  setBlockExercise(gymId: Uuid, blockId: Uuid, exerciseId: Uuid): Promise<WriteState>
  deleteBlock(gymId: Uuid, blockId: Uuid): Promise<WriteState>

  addSet(gymId: Uuid, input: NewSetInput): Promise<WriteState>
  updateSet(gymId: Uuid, setId: Uuid, patch: Partial<Pick<WorkoutSet, 'loadKg' | 'reps' | 'seconds' | 'meters' | 'rpe' | 'note' | 'doneAt'>>): Promise<WriteState>
  deleteSet(gymId: Uuid, setId: Uuid): Promise<WriteState>
  /** Undo is the affordance, not a confirm dialog. Restores a soft-deleted row in place. */
  restoreSet(gymId: Uuid, setId: Uuid): Promise<WriteState>

  createAthlete(gymId: Uuid, athleteId: Uuid, fullName: string): Promise<WriteState>
  updateAthlete(gymId: Uuid, athleteId: Uuid, patch: Partial<Pick<Athlete, 'fullName' | 'coachMembershipId' | 'planPhase' | 'planFocus' | 'phone' | 'email' | 'birthDate'>>): Promise<WriteState>
  archiveAthlete(gymId: Uuid, athleteId: Uuid): Promise<WriteState>

  createExercise(gymId: Uuid, input: NewExerciseInput): Promise<WriteState>
  archiveExercise(gymId: Uuid, exerciseId: Uuid): Promise<WriteState>

  /** Append-only: there is no updateNote. A correction is a new note. */
  addNote(gymId: Uuid, noteId: Uuid, athleteId: Uuid, body: string, opts?: { pinned?: boolean; sessionId?: Uuid | null }): Promise<WriteState>
  setNotePinned(gymId: Uuid, noteId: Uuid, pinned: boolean): Promise<WriteState>
  dismissNote(gymId: Uuid, noteId: Uuid): Promise<WriteState>

  createAppointment(gymId: Uuid, input: NewAppointmentInput): Promise<WriteState>
  updateAppointment(gymId: Uuid, appointmentId: Uuid, patch: Partial<Pick<Appointment, 'date' | 'time' | 'durationMin' | 'type' | 'notes' | 'status' | 'membershipId' | 'sessionId'>>): Promise<WriteState>
  deleteAppointment(gymId: Uuid, appointmentId: Uuid): Promise<WriteState>

  updateGym(gymId: Uuid, patch: Partial<Pick<Gym, 'name' | 'timezone' | 'displayUnit'>>): Promise<WriteState>
  inviteTrainer(gymId: Uuid, email: string, role: MemberRole): Promise<{ state: WriteState; secret?: string }>
  revokeInvite(gymId: Uuid, inviteId: Uuid): Promise<WriteState>
  updateMember(gymId: Uuid, membershipId: Uuid, patch: Partial<Pick<Membership, 'displayName' | 'role' | 'status'>>): Promise<WriteState>

  /** Exports everything this gym holds, for the owner to keep. */
  exportGym(gymId: Uuid): Promise<string>
  /** Local repo only — throws on Supabase, where the server owns the data. */
  resetDemoData?(): Promise<void>
}
