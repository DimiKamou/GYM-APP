import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { monthOf, monthWeeks, shiftMonth } from '@/domain/calendar'
import { formatDate, formatSet } from '@/domain/format'
import { performed, workoutLines, type RecapContext } from '@/domain/recap'
import type { LocalDate, Uuid } from '@/domain/types'
import { Button, Sheet } from '@/ui'
import type { Workout } from '@/screens/history/workouts'

/**
 * A past workout as one box: always the five-second read — the day, the coach, a line per
 * exercise — and, below it, every set, who typed it and every comment. Then the two ways the
 * owner asked to reach one: the last three as small buttons on one row, and a month calendar
 * whose trained days open their workout.
 *
 * `showNotes` is off on the public share page and on the athlete's own panel: the staff's
 * remarks are written for the next coach (CLAUDE.md).
 */

const heading: CSSProperties = { margin: 0, fontSize: 'var(--th-text-md)', fontWeight: 700 }

const lineList: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 'var(--th-text-sm)',
  lineHeight: 1.45,
}

const detailTitle: CSSProperties = { margin: '10px 0 2px', fontSize: 'var(--th-text-sm)', fontWeight: 700 }

const detailLine: CSSProperties = { margin: 0, fontSize: 'var(--th-text-sm)', color: 'var(--th-ink)', lineHeight: 1.5 }

const muted: CSSProperties = { margin: 0, fontSize: 'var(--th-text-sm)', color: 'var(--th-muted)', lineHeight: 1.45 }

function weekdayDate(date: LocalDate, locale: 'el' | 'en'): string {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = new Intl.DateTimeFormat(locale === 'el' ? 'el-GR' : 'en-GB', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  )
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${formatDate(date, locale)}`
}

/** «Τρίτη 13 Οκτ · Μαρία · Πόδια»: the day and who it is credited to, always both. */
export function workoutHeading(workout: Workout, names: ReadonlyMap<Uuid, string>, locale: 'el' | 'en'): string {
  const s = workout.session
  const who = names.get(s.creditedTo ?? s.loggedBy) ?? '—'
  return [weekdayDate(s.localDate, locale), who, s.title?.trim() || null].filter(Boolean).join(' · ')
}

export function WorkoutBox({
  workout,
  ctx,
  names,
  showNotes = true,
  action,
}: {
  workout: Workout
  ctx: RecapContext
  names: ReadonlyMap<Uuid, string>
  showNotes?: boolean
  action?: ReactNode
}) {
  const { t } = useTranslation()
  const lines = workoutLines(workout.blocks, workout.sets, ctx)
  const author = workout.session.loggedBy
  const blocks = [...workout.blocks].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={heading}>
        {workoutHeading(workout, names, ctx.locale)}
        {workout.session.status === 'active' ? ` · ${t('history.inProgress')}` : ''}
      </h3>
      <ul style={lineList}>
        {lines.map((line, i) => (
          <li key={i} className="num">
            {line}
          </li>
        ))}
      </ul>

      <div>
        {blocks.map((block) => {
          const sets = performed(workout.sets.filter((s) => s.blockId === block.id))
          const note = showNotes ? block.note?.trim() : ''
          if (sets.length === 0 && !note) return null
          const exercise = ctx.exercisesById.get(block.exerciseId)
          const tool = block.equipment ? ctx.equipmentName(block.equipment) : null
          return (
            <div key={block.id}>
              <p style={detailTitle}>{[ctx.exerciseName(exercise), tool].filter(Boolean).join(' · ')}</p>
              {sets.map((set, i) => {
                const by = set.createdBy && set.createdBy !== author ? names.get(set.createdBy) : null
                const remark = showNotes ? set.note?.trim() : ''
                return (
                  <p key={set.id} className="num" style={detailLine}>
                    {`${i + 1}. ${formatSet(set, set.kind, ctx.locale)}${by ? ` · ${by}` : ''}${remark ? ` — ${remark}` : ''}`}
                  </p>
                )
              })}
              {note ? <p style={muted}>💬 {note}</p> : null}
            </div>
          )
        })}
      </div>

      {showNotes && workout.session.notes?.trim() ? <p style={muted}>{workout.session.notes.trim()}</p> : null}
      {workout.session.creditedTo && workout.session.creditedTo !== workout.session.loggedBy ? (
        <p style={muted}>{t('history.writtenBy', { name: names.get(workout.session.loggedBy) ?? '—' })}</p>
      ) : null}
      {action}
    </div>
  )
}

const chipRow: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }

/**
 * The last three as small buttons on one row, the day on each; the one the coach wants opens.
 * Three stacked boxes pushed the set forms a screen down on a phone; one row costs 48px.
 */
export function RecentWorkouts({
  workouts,
  ctx,
  names,
  showNotes = true,
  label,
}: {
  workouts: readonly Workout[]
  ctx: RecapContext
  names: ReadonlyMap<Uuid, string>
  showNotes?: boolean
  label: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<Workout | null>(null)
  const three = workouts.slice(0, 3)
  if (three.length === 0) return null
  return (
    <section aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h2 style={{ ...muted, fontSize: 'var(--th-text-xs)', letterSpacing: 'var(--th-label-tracking)', textTransform: 'uppercase' }}>
        {label}
      </h2>
      <div style={chipRow}>
        {three.map((w) => (
          <Button key={w.session.id} variant="secondary" size="sm" onClick={() => setOpen(w)}>
            <span className="num">{formatDate(w.session.localDate, ctx.locale)}</span>
          </Button>
        ))}
      </div>
      <Sheet open={open !== null} onClose={() => setOpen(null)} title={t('history.workout')}>
        {open ? <WorkoutBox workout={open} ctx={ctx} names={names} showNotes={showNotes} /> : null}
      </Sheet>
    </section>
  )
}

const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, textAlign: 'center' }

const dayCell: CSSProperties = {
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--th-r-xs)',
  fontSize: 'var(--th-text-sm)',
}

/** The month as rows of seven, Monday first; a day the athlete trained opens that workout. */
export function MonthCalendar({
  workouts,
  ctx,
  names,
  today,
  showNotes = true,
}: {
  workouts: readonly Workout[]
  ctx: RecapContext
  names: ReadonlyMap<Uuid, string>
  today: LocalDate
  showNotes?: boolean
}) {
  const { t } = useTranslation()
  const byDay = useMemo(() => {
    const map = new Map<LocalDate, Workout[]>()
    for (const w of workouts) map.set(w.session.localDate, [...(map.get(w.session.localDate) ?? []), w])
    return map
  }, [workouts])
  // This month if the athlete trained in it, else the month of their latest workout: an empty
  // grid is not what someone opening a calendar came to read.
  const [month, setMonth] = useState(() =>
    workouts.some((w) => monthOf(w.session.localDate) === monthOf(today)) || workouts.length === 0
      ? monthOf(today)
      : monthOf(workouts[0].session.localDate),
  )
  const [open, setOpen] = useState<LocalDate | null>(null)
  const [y, m] = month.split('-').map(Number)
  const title = new Intl.DateTimeFormat(ctx.locale === 'el' ? 'el-GR' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  )
  const heads = t('history.weekdays').split(',')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Button variant="ghost" size="sm" icon="back" aria-label={t('history.previousMonth')} onClick={() => setMonth(shiftMonth(month, -1))} />
        <strong style={{ textTransform: 'capitalize' }}>{title}</strong>
        <Button
          variant="ghost"
          size="sm"
          icon="chevron"
          aria-label={t('history.nextMonth')}
          disabled={month >= monthOf(today)}
          onClick={() => setMonth(shiftMonth(month, 1))}
        />
      </div>
      <div style={grid} role="grid" aria-label={title}>
        {heads.map((h, i) => (
          <span key={`h${i}`} style={{ fontSize: 'var(--th-text-xs)', fontWeight: 600, color: 'var(--th-muted)' }}>
            {h}
          </span>
        ))}
        {monthWeeks(month)
          .flat()
          .map((day) => {
            const inMonth = monthOf(day) === month
            const trained = inMonth ? byDay.get(day) : undefined
            const label = String(Number(day.slice(8)))
            if (trained) {
              return (
                <button
                  key={day}
                  type="button"
                  className="th-tap num"
                  aria-label={`${formatDate(day, ctx.locale)} — ${t('history.openDay')}`}
                  onClick={() => setOpen(day)}
                  style={{ ...dayCell, background: 'var(--th-brand)', color: 'var(--th-brand-ink)', fontWeight: 700 }}
                >
                  {label}
                </button>
              )
            }
            return (
              <span
                key={day}
                className="num"
                style={{
                  ...dayCell,
                  opacity: inMonth ? 1 : 0.3,
                  outline: day === today ? '2px solid var(--th-brand)' : undefined,
                  outlineOffset: -4,
                }}
              >
                {label}
              </span>
            )
          })}
      </div>
      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open ? formatDate(open, ctx.locale) : ''}>
        {(open ? (byDay.get(open) ?? []) : []).map((w) => (
          <WorkoutBox key={w.session.id} workout={w} ctx={ctx} names={names} showNotes={showNotes} />
        ))}
      </Sheet>
    </div>
  )
}
