import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import { newId } from '@/data/ids'
import {
  addDays,
  useAthletes,
  useCreateSession,
  useTeam,
  useUpdateAppointment,
  useWeekAppointments,
} from '@/data/hooks'
import { currentLocale } from '@/i18n'
import type { Appointment, LocalDate, Uuid } from '@/domain/types'
import { Button, EmptyState, Screen, Spinner, ToastProvider, useToast } from '@/ui'
import { AppointmentCard } from '@/screens/calendar/AppointmentCard'
import { AppointmentSheet } from '@/screens/calendar/AppointmentSheet'
import {
  formatDayHeading,
  formatWeekRange,
  mondayOf,
  todayIn,
  WeekStrip,
} from '@/screens/calendar/WeekStrip'

/**
 * The week.
 *
 * Three decisions shape this screen:
 *
 *  - **Monday first**, because that is the week a Greek gym runs on. See `WeekStrip`.
 *  - **The controls are at the bottom.** The week strip, the week arrows and the primary
 *    "book a slot" button are all in the docked footer, within a thumb's reach; the top of the
 *    screen carries only the title. A coach reads this standing up, one-handed, usually with a
 *    client waiting.
 *  - **"Επόμενα" is not fenced by the week.** It reads across into the following week, which is
 *    also fetched (and therefore prefetched for the next-week tap). A Sunday evening in a
 *    strict Monday-start grid otherwise shows a coach an empty "what's next" while tomorrow is
 *    fully booked — which is exactly the moment they would have reached for the paper sheet.
 *
 * The screen owns its own `ToastProvider` for the same reason the Log screen does: deleting a
 * booking is undoable rather than confirmed, and `useToast` throws without one.
 */

const headerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
}

const sectionLabel: CSSProperties = {
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-faint)',
  margin: '4px 0 0',
}

const section: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--th-gap)' }

const footerColumn: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }

const navRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }

const rangeLabel: CSSProperties = {
  flex: '1 1 auto',
  textAlign: 'center',
  fontSize: 'var(--th-text-md)',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const emptyDay: CSSProperties = {
  margin: 0,
  color: 'var(--th-muted)',
  fontSize: 'var(--th-text-sm)',
}

/** `(date, time, id)` — two bookings can share a slot, and the order must not flicker. */
function byWhen(a: Appointment, b: Appointment): number {
  return (
    a.date.localeCompare(b.date) ||
    a.time.localeCompare(b.time) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

export function CalendarScreen() {
  return (
    <ToastProvider>
      <CalendarScreenBody />
    </ToastProvider>
  )
}

function CalendarScreenBody() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const navigate = useNavigate()
  const toast = useToast()
  const auth = useAuth()

  // The gym's zone, not the device's: at 00:30 in Athens on a phone still set to UTC, "today"
  // is still the day the gym is in. The fallback cannot be reached behind `RequireAuth`.
  const timeZone = auth.gym?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = useMemo(() => todayIn(timeZone), [timeZone])

  const [weekStart, setWeekStart] = useState<LocalDate>(() => mondayOf(today))
  const [selected, setSelected] = useState<LocalDate>(today)
  // `null` = closed. `{appointment: null}` = the new-booking form.
  const [sheet, setSheet] = useState<{ appointment: Appointment | null } | null>(null)
  const [starting, setStarting] = useState<Uuid | null>(null)

  const week = useWeekAppointments(weekStart)
  // The next week as well, so "Επόμενα" can cross the Sunday boundary — and so paging forward
  // is already in cache when the coach taps the arrow.
  const following = useWeekAppointments(addDays(weekStart, 7))
  const athletes = useAthletes()
  const team = useTeam()

  const athleteName = useMemo(
    () => new Map((athletes.data ?? []).map((athlete) => [athlete.id, athlete.fullName])),
    [athletes.data],
  )
  const coachName = useMemo(
    () => new Map((team.data ?? []).map((member) => [member.id, member.displayName])),
    [team.data],
  )
  const coaches = useMemo(
    () => (team.data ?? []).filter((member) => member.status === 'active'),
    [team.data],
  )

  const weekAppointments = useMemo(() => [...(week.data ?? [])].sort(byWhen), [week.data])
  const horizon = useMemo(
    () => [...(week.data ?? []), ...(following.data ?? [])].sort(byWhen),
    [week.data, following.data],
  )

  const dayList = useMemo(
    () => weekAppointments.filter((appointment) => appointment.date === selected),
    [weekAppointments, selected],
  )
  const upcoming = useMemo(
    () => horizon.filter((appointment) => appointment.date > selected),
    [horizon, selected],
  )

  const counts = useMemo(() => {
    const map = new Map<LocalDate, number>()
    for (const appointment of weekAppointments) {
      map.set(appointment.date, (map.get(appointment.date) ?? 0) + 1)
    }
    return map
  }, [weekAppointments])

  const createSession = useCreateSession()
  const updateAppointment = useUpdateAppointment()

  const failed = useCallback(
    () => toast.show({ message: t('errors.genericTitle'), tone: 'danger' }),
    [toast, t],
  )

  const goToWeek = (start: LocalDate) => {
    setWeekStart(start)
    // Land on today when the week contains it, and on its Monday otherwise — a week's first day
    // is a defensible place to be, whereas keeping "Thursday" across a jump is not.
    setSelected(today >= start && today <= addDays(start, 6) ? today : start)
  }

  const goToToday = () => {
    setWeekStart(mondayOf(today))
    setSelected(today)
  }

  /** Done is reversible from the toast, like every other state change on this screen. */
  const markDone = async (appointment: Appointment) => {
    const state = await updateAppointment.mutateAsync({
      appointmentId: appointment.id,
      patch: { status: 'done' },
    })
    if (state === 'failed') {
      failed()
      return
    }
    toast.show({
      message: t('calendar.completed'),
      action: {
        label: t('common.undo'),
        onAction: () => {
          void updateAppointment.mutateAsync({
            appointmentId: appointment.id,
            patch: { status: 'scheduled' },
          })
        },
      },
    })
  }

  /**
   * The one action this screen exists for: the coach is standing in front of the athlete, and
   * this is the button that turns the booking into the log they are about to write.
   *
   * The appointment keeps a pointer to the session it started (`sessionId`), which is what lets
   * the card reopen the log instead of creating a second one.
   */
  const startSession = async (appointment: Appointment) => {
    if (starting !== null) return
    setStarting(appointment.id)
    try {
      const id = newId()
      // The slot's own note is the better title: "Ημέρα ώθησης" is what the coach wrote down
      // for this booking, and it beats the generic type label every time there is one.
      const title = appointment.notes?.trim() || t(`apptTypes.${appointment.type}`)
      const state = await createSession.mutateAsync({ id, athleteId: appointment.athleteId, title })
      if (state === 'failed') {
        failed()
        return
      }
      // A failed link must not strand the coach outside the log they already have: the session
      // exists either way, and the log is where they need to be.
      await updateAppointment.mutateAsync({ appointmentId: appointment.id, patch: { sessionId: id } })
      navigate(`/log/${id}`)
    } finally {
      setStarting(null)
    }
  }

  const card = (appointment: Appointment, showDate: boolean): ReactNode => (
    <AppointmentCard
      key={appointment.id}
      appointment={appointment}
      athleteName={athleteName.get(appointment.athleteId) ?? null}
      coachName={
        appointment.membershipId ? (coachName.get(appointment.membershipId) ?? null) : null
      }
      locale={locale}
      showDate={showDate}
      onOpen={() => setSheet({ appointment })}
      onComplete={() => void markDone(appointment)}
      onStart={() => void startSession(appointment)}
      onOpenSession={() =>
        appointment.sessionId ? navigate(`/log/${appointment.sessionId}`) : undefined
      }
      starting={starting === appointment.id}
      busy={starting !== null && starting !== appointment.id}
    />
  )

  const bookButton = (
    <Button variant="primary" icon="plus" onClick={() => setSheet({ appointment: null })}>
      {t('calendar.newAppointment')}
    </Button>
  )

  return (
    <>
      <Screen
        label={t('calendar.title')}
        header={
          <div style={headerRow}>
            <h1 className="display" style={{ fontSize: 'var(--th-text-2xl)', margin: 0 }}>
              {t('calendar.title')}
            </h1>
            <span style={{ fontSize: 'var(--th-text-sm)', color: 'var(--th-muted)' }}>
              {t('counts.appointment', { count: weekAppointments.length })}
            </span>
          </div>
        }
        // False: this is a tabbed route, and `<TabBar>` below already carries the home-indicator
        // inset. Adding it here too puts a second gap above the tab bar.
        footerSafeArea={false}
        footer={
          <div style={footerColumn}>
            <div style={navRow}>
              <Button
                icon="back"
                aria-label={t('calendar.previousWeek')}
                onClick={() => goToWeek(addDays(weekStart, -7))}
              />
              <span className="display" style={rangeLabel}>
                {formatWeekRange(weekStart, locale, today)}
              </span>
              {selected !== today ? (
                <Button size="sm" icon="calendar" onClick={goToToday} aria-label={t('calendar.jumpToToday')}>
                  {t('calendar.today')}
                </Button>
              ) : null}
              <Button
                icon="chevron"
                aria-label={t('calendar.nextWeek')}
                onClick={() => goToWeek(addDays(weekStart, 7))}
              />
            </div>

            <WeekStrip
              weekStart={weekStart}
              selected={selected}
              today={today}
              locale={locale}
              counts={counts}
              onSelect={setSelected}
            />

            <Button block variant="primary" icon="plus" onClick={() => setSheet({ appointment: null })}>
              {t('calendar.newAppointment')}
            </Button>
          </div>
        }
      >
        {week.isPending ? <Spinner label={t('common.loading')} /> : null}

        {/* A failed read must never be dressed as an empty week: "nothing booked" is a sentence
            a coach acts on, and acting on it when the week is actually full is worse than a
            spinner that never resolves. */}
        {week.isError ? (
          <EmptyState
            icon="alert"
            title={t('errors.genericTitle')}
            description={t('errors.genericBody')}
            action={
              <Button icon="undo" onClick={() => void week.refetch()}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : null}

        {!week.isPending && !week.isError && weekAppointments.length === 0 ? (
          <EmptyState
            icon="calendar"
            title={t('calendar.nothingScheduled')}
            description={t('calendar.nothingScheduledHint')}
            action={bookButton}
          />
        ) : null}

        {!week.isPending && !week.isError && weekAppointments.length > 0 ? (
          <div style={section}>
            <p style={sectionLabel}>
              {selected === today ? t('calendar.today') : formatDayHeading(selected, locale)}
            </p>
            {dayList.length > 0 ? (
              dayList.map((appointment) => card(appointment, false))
            ) : (
              <p style={emptyDay}>{t('calendar.dayEmpty')}</p>
            )}
          </div>
        ) : null}

        {upcoming.length > 0 ? (
          <div style={section}>
            <p style={sectionLabel}>{t('calendar.upcoming')}</p>
            {upcoming.map((appointment) => card(appointment, true))}
          </div>
        ) : null}
      </Screen>

      <AppointmentSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        appointment={sheet?.appointment ?? null}
        defaultDate={selected}
        athletes={athletes.data ?? []}
        coaches={coaches}
        defaultCoachId={auth.membership?.id ?? null}
      />
    </>
  )
}
