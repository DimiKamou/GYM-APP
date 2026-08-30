import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import type { AuthoredNote } from '@/data/hooks'
import { Button, Chip, Field, Sheet, TextArea } from '@/ui'

/**
 * Finishing a session.
 *
 * **Two taps when nothing changed.** Open, "Ολοκλήρωση". Everything in between is optional and
 * pre-answered: the RPE is one tap out of five, and the note is prefilled with the last one
 * that is still standing, so a coach with nothing new to say confirms it by not touching it.
 *
 * **Nothing here is a duplicate.** The prefilled body is compared against what it was prefilled
 * with, and an untouched note is not re-appended — notes are append-only, so writing one on
 * every finish would grow the athlete's sheet by an identical line per session until the thing
 * a covering coach has to read is fifty copies of the same sentence. If only the pin changed,
 * the caller flips the pin on the original note instead.
 *
 * **Finishing is not locking.** It stamps `status` and `finished_at`; the sets stay editable,
 * because a coach who remembers the last set at the front desk must be able to add it. An app
 * that refuses that is worse than the paper sheet it replaced.
 */

/** The RPEs a coach actually records. Below 6 nobody writes it down. */
const RPE_OPTIONS: readonly number[] = [6, 7, 8, 9, 10]

export interface FinishPayload {
  rpe: number | null
  /** Already trimmed. Empty means "no note". */
  noteBody: string
  /** True when `noteBody` differs from what the sheet was prefilled with. */
  noteChanged: boolean
  notePinned: boolean
}

export interface FinishSheetProps {
  open: boolean
  onClose: () => void
  /** The last note still standing on this athlete, which is what the box is prefilled with. */
  lastNote: AuthoredNote | null
  busy: boolean
  onSubmit: (payload: FinishPayload) => void
}

const rowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }

const groupLabel: CSSProperties = {
  margin: '0 0 6px',
  fontSize: 'var(--th-text-xs)',
  fontWeight: 700,
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
}

export function FinishSheet({ open, onClose, lastNote, busy, onSubmit }: FinishSheetProps) {
  const { t } = useTranslation()
  const prefill = lastNote?.body ?? ''

  const [rpe, setRpe] = useState<number | null>(null)
  const [body, setBody] = useState(prefill)
  const [pinned, setPinned] = useState(lastNote?.pinned ?? false)

  // Re-prime on every open. A sheet that kept the previous session's draft would put one
  // athlete's warning onto another's sheet the next time it was opened.
  useEffect(() => {
    if (!open) return
    setRpe(null)
    setBody(prefill)
    setPinned(lastNote?.pinned ?? false)
  }, [open, prefill, lastNote?.pinned])

  function append(sentence: string) {
    setBody((current) => (current.trim() === '' ? sentence : `${current.trim()} ${sentence}`))
  }

  function submit() {
    const trimmed = body.trim()
    onSubmit({
      rpe,
      noteBody: trimmed,
      noteChanged: trimmed !== prefill.trim(),
      notePinned: pinned,
    })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('log.finishTitle')}
      footer={
        <Button variant="primary" block icon="check" loading={busy} onClick={submit}>
          {t('log.finish')}
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <p style={groupLabel}>
            {t('log.howDidItGo')} · {t('log.optional')}
          </p>
          <div style={rowStyle}>
            {RPE_OPTIONS.map((value) => (
              <Chip
                key={value}
                selected={rpe === value}
                // Tapping the selected one clears it: the only way back from a mis-tap on a
                // one-tap control, short of closing the sheet and losing the note with it.
                onClick={() => setRpe(rpe === value ? null : value)}
                ariaLabel={`${t('log.rpe')} ${value}`}
              >
                <span className="num">{value}</span>
              </Chip>
            ))}
          </div>
        </div>

        <Field label={t('log.noteForNext')}>
          {({ id }) => (
            <TextArea
              id={id}
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t('log.notePlaceholder')}
            />
          )}
        </Field>

        <div style={rowStyle}>
          <Chip onClick={() => append(t('log.quickIncreaseText'))}>{t('log.quickIncrease')}</Chip>
          <Chip onClick={() => append(t('log.quickHoldText'))}>{t('log.quickHold')}</Chip>
          <Chip onClick={() => append(t('log.quickPainText'))}>{t('log.quickPain')}</Chip>
        </div>

        <Chip icon="pin" selected={pinned} onClick={() => setPinned(!pinned)}>
          {t('log.pinNote')}
        </Chip>

        <p style={{ margin: 0, fontSize: 'var(--th-text-sm)', color: 'var(--th-muted)' }}>
          {t('log.finishHint')}
        </p>
      </div>
    </Sheet>
  )
}
