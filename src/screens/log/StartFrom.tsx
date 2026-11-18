import { useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import type { NextDay } from '@/data/hooks'
import { shiftLocalDate } from '@/domain/calendar'
import { targetText, workoutLines, type RecapContext } from '@/domain/recap'
import type { LocalDate, Uuid } from '@/domain/types'
import { Button, Card, Sheet } from '@/ui'
import { workoutHeading } from '@/screens/history/HistoryViews'
import type { Workout } from '@/screens/history/workouts'

/**
 * The two ways an empty workout can start already filled, both offers and never fences:
 *
 *  - **the programme's next day** (013): the step after the athlete's last programme workout,
 *    with every exercise's target. One tap fills it; the coach can still log anything else;
 *  - **an old day**: any workout of the last year, its exercises on the same tools, groups and
 *    supersets, nothing marked as done. Each set then starts on that day's set of the same
 *    number — a suggestion chip, never a prefilled value (see the Keypad).
 */

const line: CSSProperties = { margin: 0, fontSize: 'var(--th-text-sm)', color: 'var(--th-muted)', lineHeight: 1.45 }

export function ProgramDayOffer({
  next,
  exerciseName,
  busy,
  onStart,
}: {
  next: NextDay
  exerciseName: (id: Uuid) => string
  busy: boolean
  onStart: () => void
}) {
  const { t } = useTranslation()
  const label = dayLabel(t('programs.day'), next.day.position, next.day.name)
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <strong>{t('log.nextFromProgram', { program: next.program.name, day: label })}</strong>
        {next.day.items.map((item) => (
          <p key={item.id} className="num" style={line}>
            {exerciseName(item.exerciseId)} · {targetText(item)}
          </p>
        ))}
        <Button variant="primary" icon="plus" loading={busy} disabled={busy || next.day.items.length === 0} onClick={onStart}>
          {t('log.startDay')}
        </Button>
      </div>
    </Card>
  )
}

export function dayLabel(word: string, position: number, name: string | null): string {
  return `${word} ${position}${name?.trim() ? ` · ${name.trim()}` : ''}`
}

export function LoadOldDaySheet({
  open,
  onClose,
  workouts,
  ctx,
  names,
  today,
  busy,
  onLoad,
}: {
  open: boolean
  onClose: () => void
  workouts: readonly Workout[]
  ctx: RecapContext
  names: ReadonlyMap<Uuid, string>
  today: LocalDate
  busy: boolean
  onLoad: (workout: Workout) => void
}) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(10)
  const yearAgo = shiftLocalDate(today, -365)
  const recent = useMemo(() => workouts.filter((w) => w.session.localDate >= yearAgo), [workouts, yearAgo])
  return (
    <Sheet open={open} onClose={onClose} title={t('log.loadOldDay')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={line}>{t('log.loadOldDayHint')}</p>
        {recent.length === 0 ? <p style={line}>{t('log.noOldDays')}</p> : null}
        {recent.slice(0, shown).map((w) => (
          <Card key={w.session.id}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <strong style={{ fontSize: 'var(--th-text-sm)' }}>{workoutHeading(w, names, ctx.locale)}</strong>
              {workoutLines(w.blocks, w.sets, ctx).map((text, i) => (
                <p key={i} className="num" style={line}>
                  {text}
                </p>
              ))}
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => onLoad(w)}>
                {t('log.loadThis')}
              </Button>
            </div>
          </Card>
        ))}
        {recent.length > shown ? (
          <Button variant="ghost" onClick={() => setShown(shown + 10)}>
            {t('common.more')}
          </Button>
        ) : null}
      </div>
    </Sheet>
  )
}
