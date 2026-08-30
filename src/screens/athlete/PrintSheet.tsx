import { useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import '@/styles/print.css'

import type { ProgressData } from '@/data/repo/types'
import type { AuthoredNote } from '@/data/hooks/useNotes'
import { compareSessions, sessionAuthorId } from '@/domain/analytics'
import { EMPTY, formatDate, formatSet, type Locale } from '@/domain/format'
import { exerciseName } from '@/screens/log/ExercisePicker'
import type {
  Athlete,
  Exercise,
  LocalDate,
  Membership,
  Session,
  Uuid,
  WorkoutSet,
} from '@/domain/types'

/**
 * One athlete, on A4.
 *
 * "I can print it" is the answer to the question a gym owner actually asks — what happens when
 * the phone dies at 08:30 with a client already on the floor — and it is the only export that
 * needs no second device to be readable. So this renders two sheets, not one:
 *
 *  - **filled**: who this is, whose client they are, every pinned warning WITH its author and
 *    date, and the last N sessions as a table whose every row carries the date and the coach.
 *  - **blank**: the same masthead and the same warnings, then ruled rows. A coach can take it
 *    to the floor and write on it. That is the one thing paper still does better, and pretending
 *    otherwise is how a pilot ends up with a shared login and a biro.
 *
 * The warnings are on BOTH. A blank sheet is the one taken to the floor, so dropping the
 * "μην φορτώνεις τον αριστερό ώμο" from it is the worst possible place to save ink.
 *
 * Layout lives in `print.css`, not in `style={}`: this element is only ever laid out inside
 * `@media print`, which an inline style cannot express. What is inline here is the one
 * declaration that must hold when no stylesheet arrives at all — `display: none`.
 */

/** Never visible on screen, whatever happens to the stylesheet. See `print.css`. */
const offScreen: CSSProperties = { display: 'none' }

/** Eight sessions is roughly one A4 page of a normal athlete, and two of a busy one. */
export const DEFAULT_SESSION_LIMIT = 8

/** Rows on the unfilled sheet. Enough for a full session, few enough to stay one page. */
const BLANK_ROWS = 16
const BLANK_SET_COLUMNS = 4

export type PrintVariant = 'filled' | 'blank'

export interface PrintExerciseRow {
  blockId: Uuid
  name: string
  /** Already rendered by kind — "80×8", "10 επαναλήψεις", "20 λεπτά", "5,0 χλμ". */
  sets: string[]
}

export interface PrintSessionRow {
  id: Uuid
  localDate: LocalDate
  title: string | null
  coachName: string | null
  exercises: PrintExerciseRow[]
}

export interface PrintSheetProps {
  gymName: string
  /** Null before the athlete resolves; the sheet then prints its masthead empty. */
  athlete: Athlete | null
  coachName: string | null
  pinnedNotes: readonly AuthoredNote[]
  sessions: readonly Session[]
  /** Blocks, sets and exercises for this athlete. Undefined while it loads. */
  progress: ProgressData | undefined
  memberships: readonly Membership[]
  /** The gym's local date, resolved by the caller — never a UTC slice of an instant. */
  printedOn: LocalDate
  variant?: PrintVariant
  limit?: number
  locale?: Locale
}

/** `(position, id)`, never `position` alone: two offline inserts can mint the same position. */
function byPosition<T extends { position: number; id: Uuid }>(a: T, b: T): number {
  if (a.position !== b.position) return a.position - b.position
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * The last `limit` sessions, newest first, each with its coach and its sets already rendered.
 *
 * Exported because it is the half of this file worth asserting on directly: everything below
 * is markup, and this is where a session could silently lose its author or its order.
 */
export function buildPrintSessions(
  sessions: readonly Session[],
  progress: ProgressData | undefined,
  memberships: readonly Membership[],
  locale: Locale,
  limit: number = DEFAULT_SESSION_LIMIT,
): PrintSessionRow[] {
  const recent = sessions
    .filter((session) => session.deletedAt === null)
    .slice()
    .sort((a, b) => compareSessions(b, a))
    .slice(0, limit)
  if (recent.length === 0) return []

  const coachOf = new Map<Uuid, string>()
  for (const member of memberships) coachOf.set(member.id, member.displayName)

  const exerciseOf = new Map<Uuid, Exercise>()
  for (const exercise of progress?.exercises ?? []) exerciseOf.set(exercise.id, exercise)

  const setsOfBlock = new Map<Uuid, WorkoutSet[]>()
  for (const set of progress?.sets ?? []) {
    if (set.deletedAt !== null) continue
    const list = setsOfBlock.get(set.blockId)
    if (list) list.push(set)
    else setsOfBlock.set(set.blockId, [set])
  }

  type Block = ProgressData['blocks'][number]
  const blocksOfSession = new Map<Uuid, Block[]>()
  for (const block of progress?.blocks ?? []) {
    if (block.deletedAt !== null) continue
    const list = blocksOfSession.get(block.sessionId)
    if (list) list.push(block)
    else blocksOfSession.set(block.sessionId, [block])
  }

  return recent.map((session) => {
    const exercises = (blocksOfSession.get(session.id) ?? [])
      .slice()
      .sort(byPosition)
      .map((block) => ({
        blockId: block.id,
        name: exerciseName(exerciseOf.get(block.exerciseId), locale) || EMPTY,
        sets: (setsOfBlock.get(block.id) ?? [])
          .slice()
          .sort(byPosition)
          .map((set) => formatSet(set, set.kind, locale)),
      }))

    return {
      id: session.id,
      localDate: session.localDate,
      title: session.title,
      coachName: coachOf.get(sessionAuthorId(session)) ?? null,
      // A session whose blocks have not loaded still prints its date and its coach: an empty
      // `<tbody>` would drop the row entirely and the sheet would claim the day never happened.
      exercises:
        exercises.length > 0
          ? exercises
          : [{ blockId: session.id, name: EMPTY, sets: [] }],
    }
  })
}

export function PrintSheet({
  gymName,
  athlete,
  coachName,
  pinnedNotes,
  sessions,
  progress,
  memberships,
  printedOn,
  variant = 'filled',
  limit = DEFAULT_SESSION_LIMIT,
  locale = 'el',
}: PrintSheetProps) {
  const { t } = useTranslation()

  const rows = useMemo(
    () =>
      variant === 'blank'
        ? []
        : buildPrintSessions(sessions, progress, memberships, locale, limit),
    [variant, sessions, progress, memberships, locale, limit],
  )

  const printedLabel = t('print.printedAt', {
    date: formatDate(printedOn, locale, { withYear: true }),
  })

  return (
    <article
      className="th-print"
      style={offScreen}
      data-testid="print-sheet"
      data-variant={variant}
      // A verbatim duplicate of the screen behind it: announcing it twice is noise.
      aria-hidden="true"
    >
      <header className="th-print__head">
        <div>
          <h1 className="th-print__name">{athlete?.fullName ?? EMPTY}</h1>
          <p className="th-print__meta">
            {[coachName ?? t('athlete.noCoach'), athlete?.planPhase, athlete?.planFocus]
              .filter((part): part is string => Boolean(part))
              .join(' · ')}
          </p>
        </div>
        <p className="th-print__gym">{gymName}</p>
      </header>

      {pinnedNotes.length > 0 ? (
        <section className="th-print__notes" data-testid="print-pinned">
          <h2 className="th-print__label">{t('athlete.pinnedNotes')}</h2>
          <ul>
            {pinnedNotes.map((note) => (
              <li key={note.id}>
                {note.body}{' '}
                <span className="th-print__attr">{attribution(note, locale)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {variant === 'blank' ? (
        <BlankBody />
      ) : (
        <SessionTable rows={rows} locale={locale} />
      )}

      <footer className="th-print__foot" data-testid="print-footer">
        <span>{gymName}</span>
        {/* An undated printout of training data is a liability rather than a record: nobody
            can tell whether it describes this block or the one before last. */}
        <span className="num">{printedLabel}</span>
      </footer>
    </article>
  )
}

/** "— Μαρία Σ., 12 Φεβ 2026". The half of a note that says who to ask about it. */
function attribution(note: AuthoredNote, locale: Locale): string {
  const date = formatDate(note.createdAt.slice(0, 10), locale, { withYear: true })
  return note.authorName ? `— ${note.authorName}, ${date}` : `— ${date}`
}

function SessionTable({ rows, locale }: { rows: PrintSessionRow[]; locale: Locale }) {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return (
      <section className="th-print__section">
        <h2 className="th-print__label">{t('athlete.history')}</h2>
        <p className="th-print__empty">{t('athlete.noSessionsYet')}</p>
      </section>
    )
  }

  return (
    <section className="th-print__section">
      <h2 className="th-print__label">{t('athlete.history')}</h2>
      <table className="th-print__table" data-testid="print-sessions">
        <thead>
          <tr>
            <th scope="col">{t('common.date')}</th>
            <th scope="col">{t('athlete.coach')}</th>
            <th scope="col">{t('log.exercise')}</th>
            <th scope="col">{t('log.set')}</th>
          </tr>
        </thead>
        {rows.map((session) => (
          // One `<tbody>` per session, which is what `break-inside: avoid` can hold together.
          // The date and the coach are `rowSpan`ned across it, so no line of loads can end up
          // on the page without them.
          <tbody key={session.id} className="th-print__session" data-testid="print-session">
            {session.exercises.map((exercise, index) => (
              <tr key={exercise.blockId}>
                {index === 0 ? (
                  <th scope="rowgroup" className="th-print__when" rowSpan={session.exercises.length}>
                    <span className="num">{formatDate(session.localDate, locale, { withYear: true })}</span>
                    {session.title ? <span className="th-print__title">{session.title}</span> : null}
                  </th>
                ) : null}
                {index === 0 ? (
                  <td className="th-print__who" rowSpan={session.exercises.length}>
                    {session.coachName ?? EMPTY}
                  </td>
                ) : null}
                <td>{exercise.name}</td>
                <td className="th-print__sets num">
                  {exercise.sets.length > 0 ? exercise.sets.join(' · ') : EMPTY}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </section>
  )
}

/**
 * The sheet a coach takes to the floor when the phone is dead.
 *
 * It asks for the date and the coach's name in ink before anything else, because a page of
 * loads that reaches the desk with neither is exactly the paper sheet this app replaced.
 */
function BlankBody() {
  const { t } = useTranslation()
  const columns = Array.from({ length: BLANK_SET_COLUMNS }, (_, i) => i + 1)

  return (
    <section className="th-print__section" data-testid="print-blank">
      <h2 className="th-print__label">{t('print.blankTitle')}</h2>

      <dl className="th-print__fill">
        <div>
          <dt className="th-print__label">{t('common.date')}</dt>
          <dd className="th-print__rule" />
        </div>
        <div>
          <dt className="th-print__label">{t('athlete.coach')}</dt>
          <dd className="th-print__rule" />
        </div>
      </dl>

      <table className="th-print__table th-print__table--blank">
        <thead>
          <tr>
            <th scope="col">{t('log.exercise')}</th>
            {columns.map((index) => (
              <th key={index} scope="col">
                {t('print.setNo', { index })}
              </th>
            ))}
            <th scope="col">{t('common.notes')}</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: BLANK_ROWS }, (_, row) => (
            <tr key={row} data-testid="print-blank-row">
              <td />
              {columns.map((index) => (
                <td key={index} />
              ))}
              <td />
            </tr>
          ))}
        </tbody>
      </table>

      <p className="th-print__note">{t('print.transcribe')}</p>
    </section>
  )
}
