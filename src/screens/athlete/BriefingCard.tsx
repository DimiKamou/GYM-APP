import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { formatDate } from '@/domain/format'
import { currentLocale } from '@/i18n'
import type { Briefing, Note } from '@/domain/types'
import { Avatar, Button, Card, Icon } from '@/ui'

/**
 * The five-second read, and the reason this app exists.
 *
 * At 08:29 the athlete is walking towards a coach who has never met them. What that coach
 * needs, in this order, is: who this is and whose client they are; what they must NOT do; what
 * the last coach said; what was actually lifted last time and by whose hand; and then two ways
 * to start. Nothing else may come first — the three stat tiles and the whole Progress section
 * live below this card, because "sessions / sets / volume" answers no question anyone asks at
 * the start of a session, and the top-left corner of the paper sheet is where the warnings are.
 *
 * Every line that carries a number carries its date and its author with it. "80×8" alone is
 * worse than nothing: the coach loads a bar with it and has nobody to ask about it.
 */

export interface BriefingCardProps {
  briefing: Briefing
  onNewSession: () => void
  /** Copies the last session's exercises into a fresh one. Absent when there is no last one. */
  onRepeat: () => void
  /** True while a session is being minted, so the two buttons cannot both fire. */
  busy?: boolean
}

const head: CSSProperties = { display: 'flex', alignItems: 'center', gap: 14 }

const nameCol: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }

const coachLine: CSSProperties = {
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
}

/**
 * A pinned warning wraps to as many lines as it needs. It is deliberately NOT a `<Chip>`: the
 * chip is `white-space: nowrap`, and a truncated warning is the exact failure this card exists
 * to prevent.
 */
const pinnedNote: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 9,
  padding: '10px 12px',
  borderRadius: 'var(--th-r-sm)',
  background: 'var(--th-danger-soft)',
  border: '1px solid var(--th-danger)',
  color: 'var(--th-ink)',
  fontSize: 'var(--th-text-sm)',
  lineHeight: 1.45,
}

const noteMeta: CSSProperties = {
  color: 'var(--th-muted)',
  fontSize: 'var(--th-text-xs)',
  whiteSpace: 'nowrap',
}

const latestNoteStyle: CSSProperties = {
  margin: 0,
  padding: '10px 12px',
  borderRadius: 'var(--th-r-sm)',
  background: 'var(--th-surface-2)',
  color: 'var(--th-ink)',
  fontSize: 'var(--th-text-sm)',
  lineHeight: 1.45,
}

const lastSessionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 9,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-ink)',
  lineHeight: 1.45,
}

const actions: CSSProperties = { display: 'flex', gap: 10 }

export function BriefingCard({ briefing, onNewSession, onRepeat, busy = false }: BriefingCardProps) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const { athlete, coachName, pinnedNotes, latestNote, lastSession } = briefing

  // The briefing's "latest note" is the newest one whether pinned or not, so for an athlete
  // whose only note is the pinned warning the two are the same row. Printing it twice makes
  // the card look like there are two warnings.
  const latest = latestNote && !pinnedNotes.some((note) => note.id === latestNote.id) ? latestNote : null

  return (
    <Card raised>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="briefing">
        <div style={head}>
          <Avatar fullName={athlete.fullName} size={52} />
          <div style={nameCol}>
            <h1 className="display" style={{ fontSize: 'var(--th-text-xl)', margin: 0 }}>
              {athlete.fullName}
            </h1>
            <span style={coachLine}>
              <Icon name="users" size={15} />
              {coachName ?? t('athlete.noCoach')}
              {athlete.planPhase ? <span style={{ color: 'var(--th-faint)' }}>· {athlete.planPhase}</span> : null}
            </span>
          </div>
        </div>

        {pinnedNotes.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="pinned-notes">
            {pinnedNotes.map((note) => (
              <p key={note.id} style={pinnedNote}>
                <span aria-hidden="true" style={{ display: 'flex', paddingTop: 1, color: 'var(--th-danger)' }}>
                  <Icon name="pin" size={16} />
                </span>
                <span>
                  {note.body}{' '}
                  <span style={noteMeta}>{attribution(note, locale)}</span>
                </span>
              </p>
            ))}
          </div>
        ) : null}

        {latest ? (
          <p style={latestNoteStyle} data-testid="latest-note">
            {latest.body} <span style={noteMeta}>{attribution(latest, locale)}</span>
          </p>
        ) : null}

        {lastSession ? (
          <p style={lastSessionStyle} data-testid="last-session">
            <span aria-hidden="true" style={{ display: 'flex', paddingTop: 2, color: 'var(--th-muted)' }}>
              <Icon name="clock" size={16} />
            </span>
            <span>
              {[
                formatDate(lastSession.localDate, locale),
                lastSession.authorName,
                lastSession.title,
                lastSession.topLines[0],
              ]
                .filter((part): part is string => Boolean(part))
                .join(' · ')}
            </span>
          </p>
        ) : (
          <p style={{ ...lastSessionStyle, color: 'var(--th-muted)' }} data-testid="last-session">
            {t('athlete.noSessionsYet')}
          </p>
        )}

        <div style={actions}>
          {lastSession ? (
            <Button block icon="copy" onClick={onRepeat} disabled={busy}>
              {t('log.repeatLast')}
            </Button>
          ) : null}
          <Button block variant="primary" icon="plus" onClick={onNewSession} disabled={busy}>
            {t('athlete.newSession')}
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** "— Μαρία Σ., 12 Φεβ". The half of a note that says who to ask about it. */
function attribution(note: Note & { authorName: string | null }, locale: 'el' | 'en'): string {
  const date = formatDate(note.createdAt.slice(0, 10), locale)
  return note.authorName ? `— ${note.authorName}, ${date}` : `— ${date}`
}
