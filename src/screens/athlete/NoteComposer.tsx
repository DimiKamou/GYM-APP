import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { newId } from '@/data/ids'
import { useAddNote, useDismissNote, useSetNotePinned, type AuthoredNote } from '@/data/hooks'
import { formatDate } from '@/domain/format'
import { currentLocale } from '@/i18n'
import type { Uuid } from '@/domain/types'
import { Button, Card, Chip, EmptyState, Icon, TextArea } from '@/ui'

/**
 * Notes: written, never edited.
 *
 * There is no UPDATE policy on `notes.body` and that is deliberate — a note is the one field
 * two coaches contend for on the same row, and under last-write-wins a trainer holding a
 * three-week-old copy would republish it over a colleague's warning. So this composes a NEW
 * note every time and the copy says so out loud; a coach who expects to edit one writes half a
 * correction and leaves the wrong half standing.
 *
 * The dictation hint is not filler. The moment a note is worth writing is the moment the
 * athlete is still on the bench and the coach's hands are wet: ten seconds of the keyboard's
 * own microphone beats a paragraph typed later from memory, or not typed at all.
 */

export interface NoteComposerProps {
  athleteId: Uuid
  /** Set when the note is being written from inside a session, so it is filed against it. */
  sessionId?: Uuid | null
}

const hint: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-xs)',
  color: 'var(--th-faint)',
  lineHeight: 1.45,
}

const controls: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
}

export function NoteComposer({ athleteId, sessionId = null }: NoteComposerProps) {
  const { t } = useTranslation()
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const add = useAddNote()

  const canPost = body.trim().length > 0 && !add.isPending

  const post = () => {
    if (!canPost) return
    add.mutate(
      { id: newId(), athleteId, body: body.trim(), pinned, sessionId },
      {
        // Cleared only once the write has been accepted, so a failure leaves the text where
        // the coach can see it rather than swallowing the one thing they wanted recorded.
        onSuccess: () => {
          setBody('')
          setPinned(false)
        },
      },
    )
  }

  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <TextArea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={t('notes.placeholder')}
          aria-label={t('notes.add')}
          rows={3}
        />
        <p style={hint}>{t('notes.dictationHint')}</p>
        <div style={controls}>
          <Chip icon="pin" selected={pinned} onClick={() => setPinned((v) => !v)}>
            {pinned ? t('notes.pinned') : t('notes.pin')}
          </Chip>
          <Button variant="primary" icon="check" onClick={post} disabled={!canPost} loading={add.isPending}>
            {t('notes.save')}
          </Button>
        </div>
        <p style={hint}>{t('notes.appendOnly')}</p>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------

export interface NoteFeedProps {
  athleteId: Uuid
  notes: readonly AuthoredNote[]
}

const noteBody: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-ink)',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
}

const noteMeta: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 'var(--th-text-xs)',
  color: 'var(--th-muted)',
  flexWrap: 'wrap',
}

const noteActions: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 }

/**
 * The whole note trail, newest first — including dismissed ones, faded.
 *
 * A dismissed note stays visible on purpose: a warning that can be made to vanish is a warning
 * a colleague cannot find out ever existed.
 */
export function NoteFeed({ athleteId, notes }: NoteFeedProps) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const setPinned = useSetNotePinned()
  const dismiss = useDismissNote()

  if (notes.length === 0) {
    return <EmptyState icon="note" title={t('notes.empty')} description={t('notes.placeholder')} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-gap)' }} data-testid="notes">
      {notes.map((note) => {
        const isDismissed = note.dismissedAt !== null
        return (
          <Card key={note.id} tone={isDismissed ? 'flat' : 'surface'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: isDismissed ? 0.55 : 1 }}>
              <p style={noteBody}>{note.body}</p>
              <div style={noteMeta}>
                {note.pinned ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--th-danger)' }}>
                    <Icon name="pin" size={13} />
                    {t('notes.pinned')}
                  </span>
                ) : null}
                <span>{note.authorName ?? t('common.unassigned')}</span>
                <span className="num">{formatDate(note.createdAt.slice(0, 10), locale)}</span>
                {isDismissed ? <span>{t('notes.dismissed')}</span> : null}
              </div>
              <div style={noteActions}>
                <Button
                  size="sm"
                  variant="quiet"
                  icon="pin"
                  onClick={() => setPinned.mutate({ noteId: note.id, athleteId, pinned: !note.pinned })}
                >
                  {note.pinned ? t('notes.unpin') : t('notes.pin')}
                </Button>
                {isDismissed ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="x"
                    onClick={() => dismiss.mutate({ noteId: note.id, athleteId })}
                  >
                    {t('notes.dismiss')}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
