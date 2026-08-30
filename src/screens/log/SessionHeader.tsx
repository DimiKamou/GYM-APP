import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import type { AuthoredNote } from '@/data/hooks'
import { formatDate, formatVolume, type Locale } from '@/domain/format'
import type { Athlete, SessionTree } from '@/domain/types'
import { Avatar, Icon, Input } from '@/ui'

/**
 * The top of the Log screen: who this is, when, who is writing it — and the pinned warnings.
 *
 * **The pinned notes are here, not one navigation away.** This is the whole product in one
 * placement: the coach about to programme an overhead press has to read "Προσοχή στον αριστερό
 * ώμο" without deciding to go and look for it. A warning that needs a tap to find is a warning
 * that gets found afterwards.
 *
 * **Attribution is static text, and deliberately not a dropdown.** The prototype let a trainer
 * pick who a session was logged by, which is a lie the schema cannot tell: `logged_by` is
 * stamped by a trigger from `auth.uid()` and has no UPDATE path. The editable half is
 * `credited_to`, and it is shown only once it actually differs — a permanent "credited to
 * Δημήτρης" on every one of Δημήτρης' own sessions is noise that teaches people to stop
 * reading the line.
 */

export interface SessionHeaderProps {
  session: SessionTree
  athlete: Athlete | null | undefined
  /** Whoever's hands were on the phone. Never editable. */
  loggedByName: string | null
  /** Only supplied when `creditedTo` names someone other than `loggedBy`. */
  creditedToName: string | null
  pinnedNotes: readonly AuthoredNote[]
  volumeKg: number
  setCount: number
  locale: Locale
  onBack: () => void
  onTitleChange: (title: string) => void
}

const topRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 }

const backButton: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 44,
  height: 44,
  borderRadius: 'var(--th-r-sm)',
  background: 'var(--th-surface)',
  border: '1px solid var(--th-line)',
  color: 'var(--th-ink)',
  flex: '0 0 auto',
}

const athleteName: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-lg)',
  fontWeight: 700,
  lineHeight: 1.15,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const metaRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '2px 8px',
  fontSize: 'var(--th-text-xs)',
  color: 'var(--th-muted)',
}

const statsRow: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 16,
  marginTop: 8,
}

const statLabel: CSSProperties = {
  fontSize: 'var(--th-text-xs)',
  fontWeight: 700,
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
  marginRight: 4,
}

const statValue: CSSProperties = {
  fontSize: 'var(--th-text-md)',
  fontWeight: 700,
  color: 'var(--th-ink)',
}

const noteCard: CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 'var(--th-r-sm)',
  background: 'var(--th-danger-soft)',
  color: 'var(--th-ink)',
  fontSize: 'var(--th-text-sm)',
  lineHeight: 1.35,
}

/**
 * A note carries an INSTANT, not a calendar date, so `formatDate` is the wrong tool: it parses
 * its argument in UTC on purpose, and a UTC slice of `2026-08-12T00:30:00+03:00` is the 11th.
 * A note written just after midnight in Athens would be dated a day early on the one screen
 * where the date is what makes the warning actionable.
 */
function instantDate(at: string, locale: Locale): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'el-GR', {
    day: 'numeric',
    month: 'short',
  }).format(date)
}

const noteMeta: CSSProperties = {
  display: 'block',
  marginTop: 2,
  fontSize: 'var(--th-text-xs)',
  color: 'var(--th-muted)',
}

export function SessionHeader({
  session,
  athlete,
  loggedByName,
  creditedToName,
  pinnedNotes,
  volumeKg,
  setCount,
  locale,
  onBack,
  onTitleChange,
}: SessionHeaderProps) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(session.title ?? '')

  // The title can change under us — a colleague renaming the same session, or the tree
  // refetching after a queued write lands. Local state that never resynced would silently
  // republish the stale text on the next blur.
  useEffect(() => {
    setTitle(session.title ?? '')
  }, [session.id, session.title])

  function commitTitle() {
    const next = title.trim()
    if (next === (session.title ?? '')) return
    onTitleChange(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={topRow}>
        <button type="button" onClick={onBack} aria-label={t('common.back')} style={backButton}>
          <Icon name="back" strokeWidth={1.8} />
        </button>

        {athlete ? <Avatar fullName={athlete.fullName} size={40} /> : null}

        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <p style={athleteName}>{athlete?.fullName ?? ''}</p>
          <div style={metaRow}>
            <span className="num">{formatDate(session.localDate, locale, { withYear: true })}</span>
            <span>·</span>
            {/* Two fields, never one: who typed it, and whose session it was. */}
            <span>
              {t('log.loggedBy')} {loggedByName ?? t('common.unassigned')}
            </span>
            {creditedToName ? (
              <span style={{ color: 'var(--th-accent)' }}>
                · {t('log.creditedTo')} {creditedToName}
              </span>
            ) : null}
            {session.status === 'finished' ? (
              <span style={{ color: 'var(--th-success)', fontWeight: 700 }}>
                · {t('log.finished')}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        placeholder={t('log.workoutTitle')}
        aria-label={t('log.workoutTitle')}
      />

      {pinnedNotes.map((note) => (
        <div key={note.id} style={noteCard}>
          <span style={{ flex: '0 0 auto', color: 'var(--th-danger)', marginTop: 1 }}>
            <Icon name="alert" size={16} strokeWidth={2} />
          </span>
          <span>
            {note.body}
            {/* A warning without a name is a rumour: the covering coach has to know who to ask. */}
            <span style={noteMeta}>
              {instantDate(note.createdAt, locale)}
              {note.authorName ? ` · ${note.authorName}` : ''}
            </span>
          </span>
        </div>
      ))}

      <div style={statsRow}>
        <span>
          <span style={statLabel}>{t('log.totalVolume')}</span>
          <span className="num" style={statValue}>
            {formatVolume(volumeKg, locale)} kg
          </span>
        </span>
        <span>
          <span style={statLabel}>{t('log.totalSets')}</span>
          <span className="num" style={statValue}>
            {setCount}
          </span>
        </span>
      </div>
    </div>
  )
}
