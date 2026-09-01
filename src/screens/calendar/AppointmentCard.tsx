import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import type { Locale } from '@/domain/format'
import type { Appointment } from '@/domain/types'
import { APPOINTMENT_TOKEN } from '@/theme/tokens.contract'
import { Avatar, Button, Card, Icon } from '@/ui'
import { formatDayHeading } from '@/screens/calendar/WeekStrip'

/**
 * One booking, with the two actions that make this screen worth opening.
 *
 * **Έναρξη** creates the session and drops the coach straight into the Log — it is how the
 * workout they are standing there to run gets started, and in the prototype it was dead code in
 * both locales. **Ολοκλήρωση** marks the slot done. Everything else about a booking (moving it,
 * deleting it) is behind the card's own tap, in the sheet, because a destructive action must not
 * sit a thumb's width from the two routine ones.
 *
 * The coach's name is always on the card, next to the athlete's. Three trainers rotate across
 * one athlete here; "07:30 Σοφία" without a name is a slot nobody can ask a question about.
 */

export interface AppointmentCardProps {
  appointment: Appointment
  athleteName: string | null
  coachName: string | null
  locale: Locale
  /** True in the "Επόμενα" list, where the row is not on the day the heading names. */
  showDate?: boolean
  /** Opens the sheet — edit, move, delete. */
  onOpen: () => void
  onComplete: () => void
  onStart: () => void
  /** Only reachable once `sessionId` is set: reopens the log this booking created. */
  onOpenSession: () => void
  /** The session for this booking is being created right now. */
  starting?: boolean
  busy?: boolean
}

const TIME_RE = /^(\d{2}):(\d{2})$/

/**
 * "08:30" + 60 -> "09:30". Total: a malformed time renders as itself and the card still stands.
 * Kept as string arithmetic on purpose — a booking is a wall-clock time in the gym's day, and
 * routing it through a `Date` is what makes an appointment jump an hour at the DST boundary.
 */
function endTime(time: string, durationMin: number): string | null {
  const match = TIME_RE.exec(time)
  if (!match || !Number.isFinite(durationMin)) return null
  const total = Number(match[1]) * 60 + Number(match[2]) + Math.round(durationMin)
  const minutes = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

const row: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }

const infoButton: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  minHeight: 44,
  textAlign: 'left',
}

const timeCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 1,
  flex: '0 0 auto',
  minWidth: 52,
}

const timeStyle: CSSProperties = {
  fontSize: 'var(--th-text-md)',
  fontWeight: 700,
  color: 'var(--th-ink)',
}

const endStyle: CSSProperties = { fontSize: 'var(--th-text-xs)', color: 'var(--th-faint)' }

const mainCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
  flex: '1 1 auto',
}

const nameStyle: CSSProperties = {
  fontSize: 'var(--th-text-md)',
  fontWeight: 600,
  color: 'var(--th-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const coachStyle: CSSProperties = {
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const metaRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }

const metaText: CSSProperties = { fontSize: 'var(--th-text-xs)', color: 'var(--th-faint)' }

const doneChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 'var(--th-text-xs)',
  fontWeight: 700,
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-success)',
}

const actions: CSSProperties = { display: 'flex', gap: 10 }

export function AppointmentCard({
  appointment,
  athleteName,
  coachName,
  locale,
  showDate = false,
  onOpen,
  onComplete,
  onStart,
  onOpenSession,
  starting = false,
  busy = false,
}: AppointmentCardProps) {
  const { t } = useTranslation()
  const done = appointment.status === 'done'
  const ends = endTime(appointment.time, appointment.durationMin)
  const typeLabel = t(`apptTypes.${appointment.type}`)

  return (
    <Card
      // The type's colour is a token, re-derived per theme — the prototype's four hues measure
      // as low as 3.1:1 on Daylight's warm paper.
      style={{ borderLeft: `3px solid var(${APPOINTMENT_TOKEN[appointment.type]})` }}
    >
      <div style={row}>
        <button
          type="button"
          style={infoButton}
          onClick={onOpen}
          aria-label={`${t('calendar.openAppointment')} · ${athleteName ?? ''} ${appointment.time}`.trim()}
        >
          <span style={timeCol}>
            <span className="num" style={timeStyle}>
              {appointment.time}
            </span>
            {ends ? (
              <span className="num" style={endStyle}>
                {ends}
              </span>
            ) : null}
          </span>

          <Avatar fullName={athleteName ?? '—'} size={36} />

          <span style={mainCol}>
            <span style={nameStyle}>{athleteName ?? '—'}</span>
            {/* Attribution, not decoration: whoever is covering has to know whose slot this is. */}
            <span style={coachStyle}>
              {`${t('calendar.coach')} · ${coachName ?? t('common.unassigned')}`}
            </span>
          </span>

          <Icon name="chevron" size={18} />
        </button>

        <div style={metaRow}>
          {/* The pill is `.th-catpill`, whose colour arrives as an inline `--th-cat`; the
              appointment palette plugs into the same slot rather than growing a second class. */}
          <span
            className="th-catpill"
            style={
              {
                ['--th-cat' as string]: `var(${APPOINTMENT_TOKEN[appointment.type]})`,
              } as CSSProperties
            }
          >
            <span className="th-catpill__dot" aria-hidden="true" />
            {typeLabel}
          </span>
          <span style={metaText} className="num">
            {t('counts.minute', { count: appointment.durationMin })}
          </span>
          {showDate ? <span style={metaText}>{formatDayHeading(appointment.date, locale)}</span> : null}
          {done ? (
            <span style={doneChip}>
              <Icon name="check" size={14} strokeWidth={2.4} />
              {t('calendar.completed')}
            </span>
          ) : null}
        </div>

        <div style={actions}>
          {!done ? (
            <Button block icon="check" onClick={onComplete} disabled={busy}>
              {t('calendar.markDone')}
            </Button>
          ) : null}

          {appointment.sessionId ? (
            <Button block variant="primary" trailingIcon="chevron" onClick={onOpenSession}>
              {t('calendar.openSession')}
            </Button>
          ) : (
            <Button
              block
              variant="primary"
              icon="dumbbell"
              onClick={onStart}
              loading={starting}
              disabled={busy}
            >
              {t('calendar.startSession')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
