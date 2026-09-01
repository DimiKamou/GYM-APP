import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { newId } from '@/data/ids'
import {
  useCreateAppointment,
  useDeleteAppointment,
  useUndoableDelete,
  useUpdateAppointment,
} from '@/data/hooks'
import type { WriteState } from '@/data/repo/types'
import type {
  Appointment,
  AppointmentType,
  Athlete,
  LocalDate,
  Membership,
  Uuid,
} from '@/domain/types'
import { APPOINTMENT_TOKEN } from '@/theme/tokens.contract'
import { Button, Chip, Field, Input, Sheet, Stepper, TextArea, useToast } from '@/ui'

/**
 * Book a slot, or change one.
 *
 * Deleting is an undo toast, not a confirm — the rule everywhere in this app except removing an
 * athlete or a trainer. The undo has one wrinkle worth knowing about: the repository contract
 * has no `restoreAppointment`, and a tombstoned row is invisible to `updateAppointment`, so the
 * way back is to book it again. It comes back with a NEW id, because re-inserting the deleted
 * one is a primary-key conflict the moment this runs against Postgres rather than IndexedDB.
 * The link to a session it had already started is carried across by hand for the same reason —
 * `createAppointment` always books as `scheduled` with no session.
 *
 * Every number in here is a bounded count on a `<Stepper>`, so nothing on this sheet ever parses
 * a hand-typed decimal. The date and time are native pickers, which is what keeps "31/09" and
 * "8.30" out of the two fields that a whole week's ordering depends on.
 */

export interface AppointmentSheetProps {
  open: boolean
  onClose: () => void
  /** Present = editing an existing booking. Absent = a new one. */
  appointment?: Appointment | null
  /** The day the strip is on: what a new booking defaults to. */
  defaultDate: LocalDate
  /** Passed down rather than re-queried — the screen above already has both lists. */
  athletes: readonly Athlete[]
  coaches: readonly Membership[]
  /** Whoever is signed in. Booking yourself is the overwhelmingly common case. */
  defaultCoachId: Uuid | null
}

const APPOINTMENT_TYPES: readonly AppointmentType[] = ['personal', 'assessment', 'group', 'program']

/** A slot is scheduled to the quarter hour, and 15 minutes is the shortest thing anyone books. */
const DURATION_STEP = 15
const DURATION_MIN = 15
const DURATION_MAX = 180
const DEFAULT_DURATION = 60
const DEFAULT_TIME = '09:00'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

const chipRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }

const twoUp: CSSProperties = { display: 'flex', gap: 10 }

const half: CSSProperties = { flex: '1 1 0', minWidth: 0 }

const dangerZone: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  marginTop: 6,
  paddingTop: 'var(--th-pad)',
  borderTop: '1px solid var(--th-line-soft)',
}

interface FormState {
  athleteId: Uuid | null
  membershipId: Uuid | null
  date: LocalDate
  time: string
  durationMin: number
  type: AppointmentType
  notes: string
}

function initialState(
  appointment: Appointment | null | undefined,
  defaultDate: LocalDate,
  defaultCoachId: Uuid | null,
): FormState {
  return {
    athleteId: appointment?.athleteId ?? null,
    membershipId: appointment ? appointment.membershipId : defaultCoachId,
    date: appointment?.date ?? defaultDate,
    time: appointment?.time ?? DEFAULT_TIME,
    durationMin: appointment?.durationMin ?? DEFAULT_DURATION,
    type: appointment?.type ?? 'personal',
    notes: appointment?.notes ?? '',
  }
}

/** "" and "no note" are not the same fact, and the column is nullable for a reason. */
function trimmed(value: string): string | null {
  const next = value.trim()
  return next === '' ? null : next
}

export function AppointmentSheet({
  open,
  onClose,
  appointment,
  defaultDate,
  athletes,
  coaches,
  defaultCoachId,
}: AppointmentSheetProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const create = useCreateAppointment()
  const update = useUpdateAppointment()
  const remove = useDeleteAppointment()

  const [form, setForm] = useState<FormState>(() =>
    initialState(appointment, defaultDate, defaultCoachId),
  )

  // Reopening the sheet must not show the previous booking's half-typed note.
  useEffect(() => {
    if (!open) return
    setForm(initialState(appointment, defaultDate, defaultCoachId))
  }, [open, appointment, defaultDate, defaultCoachId])

  const restore = async (deleted: Appointment): Promise<WriteState> => {
    const id = newId()
    const state = await create.mutateAsync({
      id,
      athleteId: deleted.athleteId,
      membershipId: deleted.membershipId,
      date: deleted.date,
      time: deleted.time,
      durationMin: deleted.durationMin,
      type: deleted.type,
      notes: deleted.notes,
    })
    if (state === 'failed') return state
    // A booking that was already done, or already linked to a log, has to come back that way:
    // an undo that quietly drops the session link loses the only pointer between the two.
    if (deleted.status !== 'scheduled' || deleted.sessionId !== null) {
      return update.mutateAsync({
        appointmentId: id,
        patch: { status: deleted.status, sessionId: deleted.sessionId },
      })
    }
    return state
  }

  const undoable = useUndoableDelete<Appointment>({
    remove: (target) => remove.mutateAsync(target.id),
    restore,
  })

  const busy = create.isPending || update.isPending || undoable.isPending
  const validDate = DATE_RE.test(form.date)
  const validTime = TIME_RE.test(form.time)
  const canSave = form.athleteId !== null && validDate && validTime && !busy

  const save = async () => {
    if (!canSave || form.athleteId === null) return
    const state = appointment
      ? await update.mutateAsync({
          appointmentId: appointment.id,
          patch: {
            membershipId: form.membershipId,
            date: form.date,
            time: form.time,
            durationMin: form.durationMin,
            type: form.type,
            notes: trimmed(form.notes),
          },
        })
      : await create.mutateAsync({
          id: newId(),
          athleteId: form.athleteId,
          membershipId: form.membershipId,
          date: form.date,
          time: form.time,
          durationMin: form.durationMin,
          type: form.type,
          notes: trimmed(form.notes),
        })

    if (state === 'failed') {
      toast.show({ message: t('errors.genericTitle'), tone: 'danger' })
      return
    }
    onClose()
  }

  const destroy = async () => {
    if (!appointment) return
    const handle = await undoable.remove(appointment)
    if (handle.state === 'failed') {
      toast.show({ message: t('errors.genericTitle'), tone: 'danger' })
      return
    }
    onClose()
    toast.show({
      message: t('calendar.deleted'),
      action: handle.undo
        ? { label: t('common.undo'), onAction: () => void handle.undo?.() }
        : undefined,
    })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={appointment ? t('calendar.editAppointment') : t('calendar.newAppointment')}
      footer={
        <div style={twoUp}>
          <Button block onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            block
            variant="primary"
            onClick={() => void save()}
            disabled={!canSave}
            loading={busy}
          >
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="th-field">
        <span className="th-field__label">{t('calendar.athlete')}</span>
        {athletes.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--th-muted)', fontSize: 'var(--th-text-sm)' }}>
            {t('calendar.noAthletes')}
          </p>
        ) : (
          <div style={chipRow} role="group" aria-label={t('calendar.chooseAthlete')}>
            {athletes.map((athlete) => (
              <Chip
                key={athlete.id}
                selected={form.athleteId === athlete.id}
                // An existing booking's athlete is fixed: moving a slot to another person is a
                // different booking, and the session it may already have started is not theirs.
                onClick={
                  appointment
                    ? undefined
                    : () => setForm((f) => ({ ...f, athleteId: athlete.id }))
                }
              >
                {athlete.fullName}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="th-field">
        <span className="th-field__label">{t('calendar.coach')}</span>
        <div style={chipRow} role="group" aria-label={t('calendar.chooseCoach')}>
          <Chip
            selected={form.membershipId === null}
            onClick={() => setForm((f) => ({ ...f, membershipId: null }))}
          >
            {t('common.unassigned')}
          </Chip>
          {coaches.map((coach) => (
            <Chip
              key={coach.id}
              selected={form.membershipId === coach.id}
              onClick={() => setForm((f) => ({ ...f, membershipId: coach.id }))}
            >
              {coach.displayName}
            </Chip>
          ))}
        </div>
      </div>

      <div style={twoUp}>
        <div style={half}>
          <Field label={t('common.date')} required>
            <Input
              type="date"
              value={form.date}
              onChange={(event) => setForm((f) => ({ ...f, date: event.target.value }))}
            />
          </Field>
        </div>
        <div style={half}>
          <Field label={t('common.time')} required>
            <Input
              type="time"
              value={form.time}
              onChange={(event) => setForm((f) => ({ ...f, time: event.target.value }))}
            />
          </Field>
        </div>
      </div>

      <div className="th-field">
        <span className="th-field__label">{t('calendar.duration')}</span>
        <Stepper
          label={t('calendar.duration')}
          value={form.durationMin}
          onChange={(next) => setForm((f) => ({ ...f, durationMin: next }))}
          step={DURATION_STEP}
          min={DURATION_MIN}
          max={DURATION_MAX}
          format={(value) => t('counts.minute', { count: value })}
        />
      </div>

      <div className="th-field">
        <span className="th-field__label">{t('calendar.sessionType')}</span>
        <div style={chipRow} role="group" aria-label={t('calendar.sessionType')}>
          {APPOINTMENT_TYPES.map((type) => (
            <Chip
              key={type}
              selected={form.type === type}
              onClick={() => setForm((f) => ({ ...f, type }))}
            >
              <span
                className="th-catpill__dot"
                aria-hidden="true"
                style={{ color: `var(${APPOINTMENT_TOKEN[type]})` }}
              />
              {t(`apptTypes.${type}`)}
            </Chip>
          ))}
        </div>
      </div>

      <Field label={t('common.notes')}>
        <TextArea
          value={form.notes}
          onChange={(event) => setForm((f) => ({ ...f, notes: event.target.value }))}
        />
      </Field>

      {appointment ? (
        <div style={dangerZone}>
          <Button
            variant="dangerQuiet"
            icon="trash"
            onClick={() => void destroy()}
            disabled={busy}
          >
            {t('common.delete')}
          </Button>
        </div>
      ) : null}
    </Sheet>
  )
}
