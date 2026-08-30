/**
 * The demo gym.
 *
 * This is not test scaffolding — it is the product on day zero. Until a gym owner has a
 * Supabase project there is no server to talk to, and an app that cannot be opened cannot be
 * judged: a trainer deciding whether this beats their clipboard has to be able to hold a
 * populated one. So the local repo boots against a full three months of Iron Lab.
 *
 * Three properties this seed has that the design prototype's did not:
 *
 *  1. **Every id is fixed.** Ids are derived from an entity kind and an index, so a reload,
 *     a re-seed and a test all address the same rows. Random ids would orphan every block
 *     that pointed at an exercise the moment the demo data was rebuilt.
 *  2. **The catalogue ids are the REAL ones** from `002_seed_catalogue.sql`, and so are the
 *     `defaultSetKind` values. The prototype stored all 28 exercises as `{kg, reps}`, so a
 *     20-minute treadmill run and ten pull-ups both counted as zero volume while sitting
 *     under a label that said "volume". Διάδρομος and Σανίδα are `duration` here, Έλξεις is
 *     `bodyweight`, the rower is `distance`.
 *  3. **Two trainers, and their work is interleaved.** Δημήτρης owns the gym and Μαρία covers
 *     for him mid-block on two athletes. Rotation is the entire reason this product exists,
 *     so per-set attribution has to be visible in the first ten seconds, not after a coach
 *     has logged something themselves.
 *
 * Only the DATES move: they are offsets from "today" so the demo never looks abandoned.
 * Pass a fixed `today` and the whole structure is byte-stable, which is what the tests do.
 */

import type {
  Appointment,
  Athlete,
  Block,
  Equipment,
  Exercise,
  ExerciseCategory,
  Gym,
  Invite,
  LocalDate,
  Membership,
  Note,
  Session,
  SetKind,
  Timestamp,
  Uuid,
  WorkoutSet,
} from '@/domain/types'

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/**
 * A stable UUID from an entity kind and an index.
 *
 * These are not UUIDv7 — they carry no timestamp and must not, because a v7 id minted at seed
 * time would differ on every device and break the `(position, id)` tie-break's promise that
 * two clients sort a session identically. The `4` and `8` nibbles keep them valid v4 UUIDs so
 * they satisfy `isUuid()` and Postgres' `uuid` type alike.
 */
function seedUuid(kind: number, index: number): Uuid {
  return `5eed${kind.toString(16).padStart(4, '0')}-0000-4000-8000-${index
    .toString(16)
    .padStart(12, '0')}`
}

const KIND = {
  gym: 1,
  membership: 2,
  athlete: 3,
  session: 4,
  block: 5,
  set: 6,
  note: 7,
  appointment: 8,
  invite: 9,
  user: 10,
} as const

/** The catalogue's literal ids, byte-for-byte what `002_seed_catalogue.sql` inserts. */
function catalogueId(n: number): Uuid {
  return `ca7a1000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

export const SEED_IDS = {
  gym: seedUuid(KIND.gym, 1),
  owner: seedUuid(KIND.membership, 1),
  trainer: seedUuid(KIND.membership, 2),
  ownerUser: seedUuid(KIND.user, 1),
  trainerUser: seedUuid(KIND.user, 2),
  athletes: {
    nikos: seedUuid(KIND.athlete, 1),
    elena: seedUuid(KIND.athlete, 2),
    andreas: seedUuid(KIND.athlete, 3),
    sofia: seedUuid(KIND.athlete, 4),
    katerina: seedUuid(KIND.athlete, 5),
  },
} as const

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export const SEED_TIMEZONE = 'Europe/Athens'

/**
 * The gym's calendar date for an instant.
 *
 * `toISOString().slice(0, 10)` is the bug this exists to avoid: a session logged at 01:00 in
 * Athens is still the previous UTC day, and the sheet would file it under yesterday. `en-CA`
 * is used purely because its short date format IS `YYYY-MM-DD`.
 */
export function localDateIn(timeZone: string, at: Date = new Date()): LocalDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

function parseLocalDate(date: LocalDate): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function shiftDays(date: LocalDate, days: number): LocalDate {
  const base = parseLocalDate(date)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

/**
 * An instant for a seeded row.
 *
 * The clock time is written as UTC rather than as an Athens offset on purpose: `localDate` is
 * stored explicitly on every session and is never recomputed from this value, so the only
 * thing the instant has to be is stable and correctly ordered.
 */
function instantAt(date: LocalDate, time: string): Timestamp {
  return `${date}T${time}:00.000Z`
}

function plusMinutes(timestamp: Timestamp, minutes: number): Timestamp {
  return new Date(new Date(timestamp).getTime() + minutes * 60_000).toISOString()
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

interface CatalogueRow {
  slug: string
  n: number
  el: string
  en: string
  category: ExerciseCategory
  equipment: Equipment
  kind: SetKind
  rest: number
}

/**
 * The 28 shared exercises. `kind` is the column the prototype lacked; the five rows where it
 * is not `weight_reps` are exactly the five it got wrong.
 */
const CATALOGUE: readonly CatalogueRow[] = [
  { slug: 'bench', n: 1, el: 'Πιέσεις Στήθους', en: 'Bench Press', category: 'upper', equipment: 'barbell', kind: 'weight_reps', rest: 180 },
  { slug: 'pulldown', n: 2, el: 'Έλξεις Τροχαλίας', en: 'Lat Pulldown', category: 'upper', equipment: 'cable', kind: 'weight_reps', rest: 90 },
  { slug: 'squat', n: 3, el: 'Βαθύ Κάθισμα', en: 'Back Squat', category: 'lower', equipment: 'barbell', kind: 'weight_reps', rest: 180 },
  { slug: 'rdl', n: 4, el: 'Ρουμανικές Άρσεις', en: 'Romanian Deadlift', category: 'lower', equipment: 'barbell', kind: 'weight_reps', rest: 150 },
  { slug: 'plank', n: 5, el: 'Σανίδα', en: 'Plank', category: 'core', equipment: 'bodyweight', kind: 'duration', rest: 60 },
  { slug: 'treadmill', n: 6, el: 'Διάδρομος', en: 'Treadmill', category: 'cardio', equipment: 'cardio', kind: 'duration', rest: 60 },
  { slug: 'ohp', n: 7, el: 'Ώθηση Ώμων', en: 'Overhead Press', category: 'upper', equipment: 'barbell', kind: 'weight_reps', rest: 150 },
  { slug: 'legpress', n: 8, el: 'Πιέσεις Ποδιών', en: 'Leg Press', category: 'lower', equipment: 'machine', kind: 'weight_reps', rest: 120 },
  { slug: 'incline', n: 9, el: 'Επικλινείς Πιέσεις', en: 'Incline Dumbbell Press', category: 'upper', equipment: 'dumbbell', kind: 'weight_reps', rest: 120 },
  { slug: 'seatedrow', n: 10, el: 'Κωπηλατική Καθιστή', en: 'Seated Cable Row', category: 'upper', equipment: 'cable', kind: 'weight_reps', rest: 90 },
  { slug: 'pullup', n: 11, el: 'Έλξεις', en: 'Pull-Up', category: 'upper', equipment: 'bodyweight', kind: 'bodyweight', rest: 150 },
  { slug: 'curl', n: 12, el: 'Κάμψεις Δικεφάλων', en: 'Dumbbell Curl', category: 'upper', equipment: 'dumbbell', kind: 'weight_reps', rest: 75 },
  { slug: 'pushdown', n: 13, el: 'Εκτάσεις Τρικεφάλων', en: 'Triceps Pushdown', category: 'upper', equipment: 'cable', kind: 'weight_reps', rest: 75 },
  { slug: 'lateral', n: 14, el: 'Πλάγιες Άρσεις', en: 'Lateral Raise', category: 'upper', equipment: 'dumbbell', kind: 'weight_reps', rest: 60 },
  { slug: 'frontsquat', n: 15, el: 'Μπροστινό Κάθισμα', en: 'Front Squat', category: 'lower', equipment: 'barbell', kind: 'weight_reps', rest: 180 },
  { slug: 'deadlift', n: 16, el: 'Άρσεις Θανάτου', en: 'Conventional Deadlift', category: 'lower', equipment: 'barbell', kind: 'weight_reps', rest: 210 },
  { slug: 'legcurl', n: 17, el: 'Κάμψεις Ποδιών', en: 'Leg Curl', category: 'lower', equipment: 'machine', kind: 'weight_reps', rest: 90 },
  { slug: 'legext', n: 18, el: 'Εκτάσεις Ποδιών', en: 'Leg Extension', category: 'lower', equipment: 'machine', kind: 'weight_reps', rest: 90 },
  { slug: 'lunge', n: 19, el: 'Προβολές', en: 'Walking Lunge', category: 'lower', equipment: 'dumbbell', kind: 'weight_reps', rest: 90 },
  { slug: 'calf', n: 20, el: 'Ανυψώσεις Γαστροκνημίου', en: 'Calf Raise', category: 'lower', equipment: 'machine', kind: 'weight_reps', rest: 60 },
  { slug: 'legraise', n: 21, el: 'Άρσεις Ποδιών', en: 'Hanging Leg Raise', category: 'core', equipment: 'bodyweight', kind: 'bodyweight', rest: 60 },
  { slug: 'cablecrunch', n: 22, el: 'Κοιλιακοί Τροχαλίας', en: 'Cable Crunch', category: 'core', equipment: 'cable', kind: 'weight_reps', rest: 60 },
  { slug: 'twist', n: 23, el: 'Ρωσικές Περιστροφές', en: 'Russian Twist', category: 'core', equipment: 'bodyweight', kind: 'bodyweight', rest: 45 },
  { slug: 'rower', n: 24, el: 'Κωπηλατική Μηχανή', en: 'Rowing Machine', category: 'cardio', equipment: 'cardio', kind: 'distance', rest: 60 },
  { slug: 'bike', n: 25, el: 'Ποδήλατο', en: 'Assault Bike', category: 'cardio', equipment: 'cardio', kind: 'duration', rest: 60 },
  { slug: 'rope', n: 26, el: 'Σχοινάκι', en: 'Jump Rope', category: 'cardio', equipment: 'bodyweight', kind: 'duration', rest: 45 },
  { slug: 'hip', n: 27, el: 'Άνοιγμα Ισχίου', en: 'Hip Opener', category: 'mobility', equipment: 'bodyweight', kind: 'duration', rest: 30 },
  { slug: 'thoracic', n: 28, el: 'Θωρακική Περιστροφή', en: 'Thoracic Rotation', category: 'mobility', equipment: 'bodyweight', kind: 'duration', rest: 30 },
]

/** The catalogue predates every gym, so its audit stamps are a constant, not an offset. */
const CATALOGUE_AT: Timestamp = '2026-01-01T00:00:00.000Z'

export function buildExercises(): Exercise[] {
  return CATALOGUE.map((row) => ({
    id: catalogueId(row.n),
    // Null gym: this is the shared catalogue every gym reads and none can write.
    gymId: null,
    nameEl: row.el,
    nameEn: row.en,
    category: row.category,
    equipment: row.equipment,
    defaultSetKind: row.kind,
    defaultRestS: row.rest,
    mergedIntoId: null,
    isArchived: false,
    createdAt: CATALOGUE_AT,
    updatedAt: CATALOGUE_AT,
    deletedAt: null,
    createdBy: null,
  }))
}

const BY_SLUG = new Map(CATALOGUE.map((row) => [row.slug, row]))

function exerciseOf(slug: string): CatalogueRow {
  const row = BY_SLUG.get(slug)
  if (!row) throw new Error(`seed references an unknown exercise: ${slug}`)
  return row
}

// ---------------------------------------------------------------------------
// The gym, its coaches and its athletes
// ---------------------------------------------------------------------------

export interface SeedOptions {
  /** The gym's today. Supplied by tests; defaults to the real date in Athens. */
  today?: LocalDate
}

export interface SeedData {
  gym: Gym
  memberships: Membership[]
  athletes: Athlete[]
  exercises: Exercise[]
  sessions: Session[]
  blocks: Block[]
  sets: WorkoutSet[]
  notes: Note[]
  appointments: Appointment[]
  invites: Invite[]
}

export function buildGym(today: LocalDate = localDateIn(SEED_TIMEZONE)): Gym {
  const founded = instantAt(shiftDays(today, -400), '09:00')
  return {
    id: SEED_IDS.gym,
    name: 'Iron Lab',
    timezone: SEED_TIMEZONE,
    displayUnit: 'kg',
    createdAt: founded,
    updatedAt: founded,
    deletedAt: null,
    createdBy: SEED_IDS.owner,
  }
}

export function buildMemberships(today: LocalDate = localDateIn(SEED_TIMEZONE)): Membership[] {
  const joined = instantAt(shiftDays(today, -400), '09:00')
  const joinedLater = instantAt(shiftDays(today, -240), '11:00')
  return [
    {
      id: SEED_IDS.owner,
      gymId: SEED_IDS.gym,
      userId: SEED_IDS.ownerUser,
      displayName: 'Δημήτρης Κ.',
      email: 'dimitris@ironlab.gr',
      role: 'owner',
      status: 'active',
      createdAt: joined,
      updatedAt: joined,
      deletedAt: null,
      createdBy: null,
    },
    {
      id: SEED_IDS.trainer,
      gymId: SEED_IDS.gym,
      userId: SEED_IDS.trainerUser,
      displayName: 'Μαρία Σ.',
      email: 'maria@ironlab.gr',
      role: 'trainer',
      status: 'active',
      createdAt: joinedLater,
      updatedAt: joinedLater,
      deletedAt: null,
      createdBy: SEED_IDS.owner,
    },
  ]
}

interface AthleteSpec {
  id: Uuid
  fullName: string
  coach: Uuid | null
  planPhase: string
  planFocus: string
  memberSince: number
  birthDate: LocalDate
  phone: string
}

const ATHLETES: readonly AthleteSpec[] = [
  {
    id: SEED_IDS.athletes.nikos,
    fullName: 'Νίκος Παπαδόπουλος',
    coach: SEED_IDS.owner,
    planPhase: 'Δύναμη, εβδ. 3/6',
    planFocus: 'Πάγκος & κάθισμα',
    memberSince: -230,
    birthDate: '1991-04-18',
    phone: '+30 694 111 2233',
  },
  {
    id: SEED_IDS.athletes.elena,
    fullName: 'Έλενα Γεωργίου',
    coach: SEED_IDS.trainer,
    planPhase: 'Επιστροφή, εβδ. 2/8',
    planFocus: 'Σταδιακή επιβάρυνση γόνατος',
    memberSince: -180,
    birthDate: '1988-11-02',
    phone: '+30 697 444 5566',
  },
  {
    id: SEED_IDS.athletes.andreas,
    fullName: 'Ανδρέας Μιχαηλίδης',
    coach: SEED_IDS.owner,
    planPhase: 'Υπερτροφία, εβδ. 4/6',
    planFocus: 'Άνω κορμός, 4×/εβδ.',
    memberSince: -140,
    birthDate: '1996-06-27',
    phone: '+30 693 777 8899',
  },
  {
    id: SEED_IDS.athletes.sofia,
    fullName: 'Σοφία Ρούσσου',
    coach: SEED_IDS.trainer,
    planPhase: 'Φυσική κατάσταση',
    planFocus: 'Κορμός & αερόβια',
    memberSince: -95,
    birthDate: '1999-02-14',
    phone: '+30 698 222 3344',
  },
  {
    // Deliberately unassigned and with no history: this is the athlete the exercise picker's
    // "most-logged in the gym" fallback exists for, and the roster's empty-state.
    id: SEED_IDS.athletes.katerina,
    fullName: 'Κατερίνα Δήμου',
    coach: null,
    planPhase: 'Νέα εγγραφή',
    planFocus: 'Αξιολόγηση κίνησης',
    memberSince: -4,
    birthDate: '2001-09-09',
    phone: '+30 690 555 6677',
  },
]

export function buildAthletes(today: LocalDate = localDateIn(SEED_TIMEZONE)): Athlete[] {
  return ATHLETES.map((spec) => {
    const at = instantAt(shiftDays(today, spec.memberSince), '10:00')
    return {
      id: spec.id,
      gymId: SEED_IDS.gym,
      fullName: spec.fullName,
      coachMembershipId: spec.coach,
      planPhase: spec.planPhase,
      planFocus: spec.planFocus,
      birthDate: spec.birthDate,
      phone: spec.phone,
      email: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      createdBy: spec.coach ?? SEED_IDS.owner,
    }
  })
}

// ---------------------------------------------------------------------------
// The history
// ---------------------------------------------------------------------------

/** One logged set, in whatever units its exercise is actually measured in. */
interface SetSpec {
  kg?: number
  reps?: number
  sec?: number
  m?: number
  rpe?: number
}

interface BlockSpec {
  exercise: string
  sets: SetSpec[]
}

interface SessionSpec {
  athlete: Uuid
  /** Whose hands were on the sheet. Μαρία covering Δημήτρης is the point of the demo. */
  by: Uuid
  daysAgo: number
  time: string
  title: string
  notes?: string
  blocks: BlockSpec[]
}

const { nikos, elena, andreas, sofia } = SEED_IDS.athletes
const OWNER = SEED_IDS.owner
const MARIA = SEED_IDS.trainer

/**
 * Sixteen sessions over three months.
 *
 * The bench and squat lines climb in the increments a real block uses (2,5 kg a fortnight,
 * not 10 kg a week), because the Progress chart is only convincing if the shape is one a
 * coach recognises. Two of Νίκος' sessions and one of Έλενα's are logged by the OTHER coach:
 * that is what makes "80×8 · 12 Αυγ · Μαρία" visible on first open.
 */
const SESSIONS: readonly SessionSpec[] = [
  {
    athlete: nikos, by: OWNER, daysAgo: 84, time: '07:30', title: 'Άνω κορμός — Ώθηση',
    blocks: [
      { exercise: 'bench', sets: [{ kg: 62.5, reps: 8, rpe: 7 }, { kg: 62.5, reps: 6, rpe: 8 }] },
      { exercise: 'ohp', sets: [{ kg: 35, reps: 10 }, { kg: 35, reps: 9 }] },
    ],
  },
  {
    athlete: nikos, by: OWNER, daysAgo: 77, time: '07:30', title: 'Κάτω κορμός — Δύναμη',
    blocks: [
      { exercise: 'squat', sets: [{ kg: 90, reps: 5 }, { kg: 92.5, reps: 5, rpe: 8 }] },
      { exercise: 'rdl', sets: [{ kg: 70, reps: 8 }, { kg: 70, reps: 8 }] },
    ],
  },
  {
    athlete: nikos, by: OWNER, daysAgo: 63, time: '07:30', title: 'Άνω κορμός — Ώθηση',
    notes: 'Καλή τεχνική, χωρίς ενόχληση στον ώμο.',
    blocks: [
      { exercise: 'bench', sets: [{ kg: 65, reps: 8 }, { kg: 65, reps: 6 }] },
      { exercise: 'ohp', sets: [{ kg: 37.5, reps: 9 }] },
    ],
  },
  {
    athlete: nikos, by: MARIA, daysAgo: 56, time: '08:00', title: 'Κάτω κορμός — Δύναμη',
    notes: 'Αντικατάσταση Δημήτρη. Βάθος καλό, χωρίς ζώνη.',
    blocks: [
      { exercise: 'squat', sets: [{ kg: 95, reps: 5 }, { kg: 97.5, reps: 4, rpe: 9 }] },
      { exercise: 'rdl', sets: [{ kg: 75, reps: 8 }] },
    ],
  },
  {
    athlete: nikos, by: OWNER, daysAgo: 35, time: '07:30', title: 'Άνω κορμός — Ώθηση',
    blocks: [
      { exercise: 'bench', sets: [{ kg: 67.5, reps: 8 }, { kg: 67.5, reps: 6 }] },
      { exercise: 'pullup', sets: [{ reps: 10 }, { reps: 8 }] },
    ],
  },
  {
    athlete: nikos, by: OWNER, daysAgo: 21, time: '07:30', title: 'Κάτω κορμός — Δύναμη',
    blocks: [
      { exercise: 'squat', sets: [{ kg: 100, reps: 5 }, { kg: 102.5, reps: 4, rpe: 9 }] },
      { exercise: 'deadlift', sets: [{ kg: 120, reps: 3 }, { kg: 120, reps: 3 }] },
    ],
  },
  {
    athlete: nikos, by: MARIA, daysAgo: 7, time: '08:00', title: 'Άνω κορμός — Ώθηση',
    notes: 'Καλή ταχύτητα μπάρας στα 72,5.',
    blocks: [
      { exercise: 'bench', sets: [{ kg: 70, reps: 8 }, { kg: 72.5, reps: 5, rpe: 9 }] },
      { exercise: 'ohp', sets: [{ kg: 40, reps: 9 }] },
      { exercise: 'plank', sets: [{ sec: 45 }, { sec: 45 }] },
    ],
  },

  {
    athlete: elena, by: MARIA, daysAgo: 70, time: '17:30', title: 'Ολόσωμη — Ελαφριά',
    notes: 'Χωρίς πόνο στο γόνατο.',
    blocks: [
      { exercise: 'legpress', sets: [{ kg: 60, reps: 12 }, { kg: 60, reps: 12 }] },
      { exercise: 'pulldown', sets: [{ kg: 30, reps: 12 }] },
    ],
  },
  {
    athlete: elena, by: MARIA, daysAgo: 42, time: '17:30', title: 'Ολόσωμη — Ελαφριά',
    blocks: [
      { exercise: 'legpress', sets: [{ kg: 70, reps: 12 }, { kg: 70, reps: 12 }] },
      { exercise: 'seatedrow', sets: [{ kg: 35, reps: 12 }] },
    ],
  },
  {
    athlete: elena, by: OWNER, daysAgo: 10, time: '18:00', title: 'Ολόσωμη — Προοδευτική',
    notes: 'Κάλυψη για Μαρία. Ανέβασμα 10 kg στην πρέσα, χωρίς ενόχληση.',
    blocks: [
      { exercise: 'legpress', sets: [{ kg: 80, reps: 10 }, { kg: 80, reps: 10 }] },
      { exercise: 'treadmill', sets: [{ sec: 1200 }] },
    ],
  },

  {
    athlete: andreas, by: OWNER, daysAgo: 49, time: '19:00', title: 'Άνω — Υπερτροφία',
    blocks: [
      { exercise: 'incline', sets: [{ kg: 24, reps: 12 }, { kg: 26, reps: 10 }] },
      { exercise: 'lateral', sets: [{ kg: 10, reps: 15 }, { kg: 12, reps: 12 }] },
    ],
  },
  {
    athlete: andreas, by: OWNER, daysAgo: 40, time: '19:00', title: 'Κάτω — Υπερτροφία',
    blocks: [
      { exercise: 'legpress', sets: [{ kg: 140, reps: 12 }, { kg: 150, reps: 10 }] },
      { exercise: 'legcurl', sets: [{ kg: 45, reps: 12 }, { kg: 45, reps: 12 }] },
    ],
  },
  {
    athlete: andreas, by: MARIA, daysAgo: 26, time: '19:30', title: 'Άνω — Υπερτροφία',
    blocks: [
      { exercise: 'incline', sets: [{ kg: 26, reps: 12 }, { kg: 28, reps: 10 }] },
      { exercise: 'pullup', sets: [{ reps: 10 }, { reps: 8 }] },
    ],
  },
  {
    athlete: andreas, by: OWNER, daysAgo: 12, time: '19:00', title: 'Κάτω — Υπερτροφία',
    blocks: [
      { exercise: 'legpress', sets: [{ kg: 150, reps: 12 }, { kg: 160, reps: 10 }] },
      { exercise: 'legext', sets: [{ kg: 55, reps: 12 }, { kg: 55, reps: 11 }] },
    ],
  },

  {
    athlete: sofia, by: MARIA, daysAgo: 30, time: '09:00', title: 'Κορμός & αερόβια',
    blocks: [
      { exercise: 'plank', sets: [{ sec: 40 }, { sec: 45 }] },
      { exercise: 'treadmill', sets: [{ sec: 1500 }] },
    ],
  },
  {
    athlete: sofia, by: MARIA, daysAgo: 5, time: '09:00', title: 'Κορμός & αερόβια',
    blocks: [
      { exercise: 'plank', sets: [{ sec: 50 }, { sec: 55 }] },
      { exercise: 'rower', sets: [{ m: 2000 }] },
      { exercise: 'twist', sets: [{ reps: 20 }] },
    ],
  },
]

interface History {
  sessions: Session[]
  blocks: Block[]
  sets: WorkoutSet[]
}

function buildHistory(today: LocalDate): History {
  const sessions: Session[] = []
  const blocks: Block[] = []
  const sets: WorkoutSet[] = []
  let blockIndex = 0
  let setIndex = 0

  SESSIONS.forEach((spec, i) => {
    const localDate = shiftDays(today, -spec.daysAgo)
    const startedAt = instantAt(localDate, spec.time)
    const sessionId = seedUuid(KIND.session, i + 1)

    sessions.push({
      id: sessionId,
      gymId: SEED_IDS.gym,
      athleteId: spec.athlete,
      loggedBy: spec.by,
      // Null, not a copy of loggedBy: the credit is only interesting once someone has moved
      // it, and a pre-filled copy would make every session look re-credited.
      creditedTo: null,
      appointmentId: null,
      title: spec.title,
      notes: spec.notes ?? null,
      status: 'finished',
      startedAt,
      finishedAt: plusMinutes(startedAt, 60),
      localDate,
      createdAt: startedAt,
      updatedAt: startedAt,
      deletedAt: null,
      createdBy: spec.by,
    })

    spec.blocks.forEach((blockSpec, blockPosition) => {
      const exercise = exerciseOf(blockSpec.exercise)
      blockIndex += 1
      const blockId = seedUuid(KIND.block, blockIndex)
      blocks.push({
        id: blockId,
        gymId: SEED_IDS.gym,
        sessionId,
        exerciseId: catalogueId(exercise.n),
        position: blockPosition,
        createdAt: startedAt,
        updatedAt: startedAt,
        deletedAt: null,
        createdBy: spec.by,
      })

      blockSpec.sets.forEach((setSpec, setPosition) => {
        setIndex += 1
        sets.push({
          id: seedUuid(KIND.set, setIndex),
          gymId: SEED_IDS.gym,
          blockId,
          position: setPosition,
          // The exercise decides what the numbers mean. Twenty treadmill minutes stored as
          // `{kg: 0, reps: 20}` is the prototype's silent zero-volume bug.
          kind: exercise.kind,
          targetKg: null,
          targetReps: null,
          loadKg: setSpec.kg ?? null,
          reps: setSpec.reps ?? null,
          seconds: setSpec.sec ?? null,
          meters: setSpec.m ?? null,
          rpe: setSpec.rpe ?? null,
          note: null,
          doneAt: startedAt,
          createdAt: startedAt,
          updatedAt: startedAt,
          deletedAt: null,
          createdBy: spec.by,
        })
      })
    })
  })

  return { sessions, blocks, sets }
}

// ---------------------------------------------------------------------------
// Notes and appointments
// ---------------------------------------------------------------------------

interface NoteSpec {
  athlete: Uuid
  author: Uuid
  daysAgo: number
  body: string
  pinned: boolean
  /** Index into SESSIONS, when the note was written against a specific session. */
  sessionIndex?: number
}

const NOTES: readonly NoteSpec[] = [
  {
    // The line the Briefing Card exists for. A covering coach has to see it before they hand
    // Νίκος a barbell, which is why it is pinned and written by the OTHER trainer.
    athlete: nikos, author: MARIA, daysAgo: 60, pinned: true,
    body: 'Προσοχή στον αριστερό ώμο — χωρίς πιέσεις πάνω από το κεφάλι με βαριά μπάρα.',
  },
  {
    athlete: nikos, author: OWNER, daysAgo: 7, pinned: false, sessionIndex: 6,
    body: 'Καλή ταχύτητα μπάρας στα 72,5. Δοκιμή για ρεκόρ σε δύο εβδομάδες.',
  },
  {
    athlete: elena, author: MARIA, daysAgo: 72, pinned: true,
    body: 'Επιστροφή από τραυματισμό γόνατος — προοδευτική επιβάρυνση, χωρίς βαθύ κάθισμα.',
  },
  {
    athlete: elena, author: OWNER, daysAgo: 10, pinned: false, sessionIndex: 9,
    body: 'Χωρίς πόνο στα 80 kg. Ανεβάζουμε 5 kg την επόμενη φορά.',
  },
  {
    athlete: andreas, author: OWNER, daysAgo: 50, pinned: false,
    body: 'Μπλοκ υπερτροφίας, τέσσερις προπονήσεις την εβδομάδα.',
  },
  {
    athlete: sofia, author: MARIA, daysAgo: 30, pinned: false,
    body: 'Έμφαση σε κορμό και αερόβια, δύο φορές την εβδομάδα.',
  },
  {
    athlete: SEED_IDS.athletes.katerina, author: OWNER, daysAgo: 3, pinned: true,
    body: 'Νέα εγγραφή — αξιολόγηση κίνησης πριν την πρώτη προπόνηση.',
  },
]

function buildNotes(today: LocalDate, sessions: readonly Session[]): Note[] {
  return NOTES.map((spec, i) => {
    const at = instantAt(shiftDays(today, -spec.daysAgo), '20:00')
    return {
      id: seedUuid(KIND.note, i + 1),
      gymId: SEED_IDS.gym,
      athleteId: spec.athlete,
      sessionId: spec.sessionIndex === undefined ? null : sessions[spec.sessionIndex].id,
      body: spec.body,
      pinned: spec.pinned,
      author: spec.author,
      createdAt: at,
      dismissedAt: null,
      dismissedBy: null,
    }
  })
}

interface AppointmentSpec {
  athlete: Uuid
  membership: Uuid
  inDays: number
  time: string
  durationMin: number
  type: Appointment['type']
  notes: string | null
  status: Appointment['status']
}

const APPOINTMENTS: readonly AppointmentSpec[] = [
  { athlete: sofia, membership: MARIA, inDays: -1, time: '07:30', durationMin: 45, type: 'personal', notes: null, status: 'done' },
  { athlete: nikos, membership: OWNER, inDays: 0, time: '08:30', durationMin: 60, type: 'personal', notes: 'Ημέρα ώθησης', status: 'scheduled' },
  { athlete: andreas, membership: OWNER, inDays: 0, time: '10:00', durationMin: 60, type: 'personal', notes: null, status: 'scheduled' },
  { athlete: elena, membership: MARIA, inDays: 0, time: '17:30', durationMin: 45, type: 'assessment', notes: 'Έλεγχος κίνησης', status: 'scheduled' },
  { athlete: SEED_IDS.athletes.katerina, membership: MARIA, inDays: 1, time: '09:00', durationMin: 60, type: 'assessment', notes: 'Πρώτη αξιολόγηση', status: 'scheduled' },
  { athlete: nikos, membership: OWNER, inDays: 2, time: '08:30', durationMin: 60, type: 'personal', notes: 'Κάτω κορμός', status: 'scheduled' },
  { athlete: andreas, membership: OWNER, inDays: 2, time: '11:00', durationMin: 30, type: 'program', notes: 'Ανασκόπηση μπλοκ', status: 'scheduled' },
  { athlete: elena, membership: MARIA, inDays: 4, time: '18:00', durationMin: 45, type: 'personal', notes: null, status: 'scheduled' },
]

function buildAppointments(today: LocalDate): Appointment[] {
  return APPOINTMENTS.map((spec, i) => {
    const date = shiftDays(today, spec.inDays)
    const at = instantAt(shiftDays(today, Math.min(spec.inDays, 0) - 2), '12:00')
    return {
      id: seedUuid(KIND.appointment, i + 1),
      gymId: SEED_IDS.gym,
      athleteId: spec.athlete,
      membershipId: spec.membership,
      date,
      time: spec.time,
      durationMin: spec.durationMin,
      type: spec.type,
      notes: spec.notes,
      status: spec.status,
      sessionId: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      createdBy: spec.membership,
    }
  })
}

function buildInvites(today: LocalDate): Invite[] {
  const at = instantAt(shiftDays(today, -6), '13:00')
  return [
    {
      id: seedUuid(KIND.invite, 1),
      gymId: SEED_IDS.gym,
      email: 'lena@ironlab.gr',
      role: 'trainer',
      expiresAt: instantAt(shiftDays(today, 8), '13:00'),
      maxUses: 1,
      uses: 0,
      revokedAt: null,
      acceptedAt: null,
      acceptedBy: null,
      createdAt: at,
      // No `secret`: it exists exactly once, in the response that mints it, and a seed that
      // carried one would be teaching every reader that invites are re-readable.
    },
  ]
}

// ---------------------------------------------------------------------------

/** The whole demo gym. Same input, same bytes. */
export function buildSeed(options: SeedOptions = {}): SeedData {
  const today = options.today ?? localDateIn(SEED_TIMEZONE)
  const history = buildHistory(today)
  return {
    gym: buildGym(today),
    memberships: buildMemberships(today),
    athletes: buildAthletes(today),
    exercises: buildExercises(),
    sessions: history.sessions,
    blocks: history.blocks,
    sets: history.sets,
    notes: buildNotes(today, history.sessions),
    appointments: buildAppointments(today),
    invites: buildInvites(today),
  }
}

/**
 * Who the app is when there is no Supabase project: the owner of the demo gym.
 *
 * Exposed separately from `buildSeed()` so `AuthProvider` can resolve an identity without
 * constructing three months of history it will never read.
 */
export function demoIdentity(): { userId: Uuid; membership: Membership; gym: Gym } {
  const today = localDateIn(SEED_TIMEZONE)
  const membership = buildMemberships(today)[0]
  return { userId: SEED_IDS.ownerUser, membership, gym: buildGym(today) }
}
