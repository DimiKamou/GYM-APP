import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { newId } from '@/data/ids'
import {
  useArchiveAthlete,
  useCreateAthlete,
  useTeam,
  useUpdateAthlete,
  type AthletePatch,
} from '@/data/hooks'
import type { Athlete, Uuid } from '@/domain/types'
import { Button, Chip, Field, Input, Sheet } from '@/ui'

/**
 * Create or edit one athlete.
 *
 * The coach field is an assignment, not a fence: any active member may log for any athlete
 * (see the build notes — fencing by assignment stops work the day a coach covers for a sick
 * colleague, and the workaround for that is a shared login). It is here because a roster of
 * forty needs a filter and a reporting dimension, not because it grants anything.
 *
 * Removing an athlete is one of the two actions in this app that still gets a real confirm
 * rather than an undo toast: a six-second toast is not a way back from something a coach only
 * notices next week, and there is no restore for it in the repository contract.
 */

export interface AthleteSheetProps {
  open: boolean
  onClose: () => void
  /** Present = editing. Absent = creating. */
  athlete?: Athlete | null
  onCreated?: (athleteId: Uuid) => void
  onArchived?: () => void
}

const chipRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }

const dangerZone: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  marginTop: 6,
  paddingTop: 'var(--th-pad)',
  borderTop: '1px solid var(--th-line-soft)',
}

const confirmText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-ink)',
  lineHeight: 1.45,
}

interface FormState {
  fullName: string
  coachMembershipId: Uuid | null
  planPhase: string
  planFocus: string
  phone: string
  email: string
}

function initialState(athlete: Athlete | null | undefined): FormState {
  return {
    fullName: athlete?.fullName ?? '',
    coachMembershipId: athlete?.coachMembershipId ?? null,
    planPhase: athlete?.planPhase ?? '',
    planFocus: athlete?.planFocus ?? '',
    phone: athlete?.phone ?? '',
    email: athlete?.email ?? '',
  }
}

/** Empty strings are stored as null: "" and "no phone number" are not the same fact. */
function trimmed(value: string): string | null {
  const next = value.trim()
  return next === '' ? null : next
}

export function AthleteSheet({ open, onClose, athlete, onCreated, onArchived }: AthleteSheetProps) {
  const { t } = useTranslation()
  const team = useTeam()
  const create = useCreateAthlete()
  const update = useUpdateAthlete()
  const archive = useArchiveAthlete()

  const [form, setForm] = useState<FormState>(() => initialState(athlete))
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Reopening the sheet must not show the previous athlete's half-typed name.
  useEffect(() => {
    if (!open) return
    setForm(initialState(athlete))
    setConfirmingDelete(false)
  }, [open, athlete])

  const coaches = (team.data ?? []).filter((member) => member.status === 'active')
  const busy = create.isPending || update.isPending || archive.isPending
  const canSave = form.fullName.trim().length > 0 && !busy

  const patch = (): AthletePatch => ({
    fullName: form.fullName.trim(),
    coachMembershipId: form.coachMembershipId,
    planPhase: trimmed(form.planPhase),
    planFocus: trimmed(form.planFocus),
    phone: trimmed(form.phone),
    email: trimmed(form.email),
  })

  const save = async () => {
    if (!canSave) return
    if (athlete) {
      await update.mutateAsync({ athleteId: athlete.id, patch: patch() })
      onClose()
      return
    }
    // `createAthlete` takes only the name — the rest of the row is a second, ordinary patch,
    // which is also what makes the offline path one create followed by one update in the outbox.
    const id = newId()
    await create.mutateAsync({ id, fullName: form.fullName.trim() })
    await update.mutateAsync({ athleteId: id, patch: patch() })
    onClose()
    onCreated?.(id)
  }

  const remove = async () => {
    if (!athlete) return
    await archive.mutateAsync(athlete.id)
    onClose()
    onArchived?.()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={athlete ? t('athlete.edit') : t('athletes.add')}
      footer={
        <div style={{ display: 'flex', gap: 10 }}>
          <Button block onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button block variant="primary" onClick={() => void save()} disabled={!canSave} loading={busy}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <Field label={t('common.name')} required>
        <Input
          value={form.fullName}
          onChange={(event) => setForm((f) => ({ ...f, fullName: event.target.value }))}
          autoComplete="name"
        />
      </Field>

      <div className="th-field">
        <span className="th-field__label">{t('athlete.assignedCoach')}</span>
        <div style={chipRow} role="group" aria-label={t('athlete.assignedCoach')}>
          <Chip
            selected={form.coachMembershipId === null}
            onClick={() => setForm((f) => ({ ...f, coachMembershipId: null }))}
          >
            {t('common.unassigned')}
          </Chip>
          {coaches.map((coach) => (
            <Chip
              key={coach.id}
              selected={form.coachMembershipId === coach.id}
              onClick={() => setForm((f) => ({ ...f, coachMembershipId: coach.id }))}
            >
              {coach.displayName}
            </Chip>
          ))}
        </div>
      </div>

      <Field label={t('athlete.planPhase')}>
        <Input
          value={form.planPhase}
          onChange={(event) => setForm((f) => ({ ...f, planPhase: event.target.value }))}
        />
      </Field>

      <Field label={t('athlete.planFocus')}>
        <Input
          value={form.planFocus}
          onChange={(event) => setForm((f) => ({ ...f, planFocus: event.target.value }))}
        />
      </Field>

      <Field label={t('common.email')}>
        <Input
          type="email"
          value={form.email}
          onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
          autoComplete="email"
          inputMode="email"
        />
      </Field>

      <Field label={t('athlete.phone')}>
        <Input
          type="tel"
          value={form.phone}
          onChange={(event) => setForm((f) => ({ ...f, phone: event.target.value }))}
          autoComplete="tel"
          inputMode="tel"
        />
      </Field>

      {athlete ? (
        <div style={dangerZone}>
          {confirmingDelete ? (
            <>
              <p style={confirmText}>{t('athlete.deleteConfirm')}</p>
              <p style={{ ...confirmText, color: 'var(--th-muted)' }}>{t('athlete.deleteExplain')}</p>
              <div style={{ display: 'flex', gap: 10 }}>
                <Button block onClick={() => setConfirmingDelete(false)} disabled={busy}>
                  {t('common.cancel')}
                </Button>
                <Button block variant="danger" icon="trash" onClick={() => void remove()} loading={archive.isPending}>
                  {t('common.delete')}
                </Button>
              </div>
            </>
          ) : (
            <Button variant="dangerQuiet" icon="trash" onClick={() => setConfirmingDelete(true)} disabled={busy}>
              {t('athlete.archive')}
            </Button>
          )}
        </div>
      ) : null}
    </Sheet>
  )
}
