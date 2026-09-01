import { useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import type { ProgressData } from '@/data/repo/types'
import { compareSessions, sessionAuthorId, sessionVolume } from '@/domain/analytics'
import { formatDate, formatVolume } from '@/domain/format'
import { currentLocale } from '@/i18n'
import type { Membership, Session, Uuid, WorkoutSet } from '@/domain/types'
import { Card, EmptyState, Icon } from '@/ui'

/**
 * An athlete's sessions, newest first.
 *
 * Every row carries the author, not just the date: three trainers rotate across one athlete,
 * and "who wrote this" is the question the paper sheet could not answer. The volume is computed
 * with the same `sessionVolume` the Log screen and the charts use — a second implementation
 * here would disagree with them the first time a cardio set was logged.
 */

export interface HistoryListProps {
  sessions: readonly Session[]
  /** Blocks and sets for this athlete. Undefined while it loads; rows then show no volume. */
  progress: ProgressData | undefined
  memberships: readonly Membership[]
  onOpen: (sessionId: Uuid) => void
}

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  textAlign: 'left',
}

const left: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: '1 1 auto' }

const titleStyle: CSSProperties = {
  fontSize: 'var(--th-text-md)',
  fontWeight: 600,
  color: 'var(--th-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const metaStyle: CSSProperties = {
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const right: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 2,
  flex: '0 0 auto',
}

const unitStyle: CSSProperties = {
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-faint)',
}

const liveBadge: CSSProperties = {
  fontSize: 'var(--th-text-xs)',
  fontWeight: 700,
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-accent)',
}

export function HistoryList({ sessions, progress, memberships, onOpen }: HistoryListProps) {
  const { t } = useTranslation()
  const locale = currentLocale()

  const ordered = useMemo(
    () => sessions.filter((s) => s.deletedAt === null).slice().sort((a, b) => compareSessions(b, a)),
    [sessions],
  )

  /** setsBySession, built once per data change rather than per row. */
  const setsBySession = useMemo(() => {
    const map = new Map<Uuid, WorkoutSet[]>()
    if (!progress) return map
    const sessionOfBlock = new Map<Uuid, Uuid>()
    for (const block of progress.blocks) {
      if (block.deletedAt === null) sessionOfBlock.set(block.id, block.sessionId)
    }
    for (const set of progress.sets) {
      const sessionId = sessionOfBlock.get(set.blockId)
      if (!sessionId) continue
      const list = map.get(sessionId)
      if (list) list.push(set)
      else map.set(sessionId, [set])
    }
    return map
  }, [progress])

  const nameOf = useMemo(() => {
    const names = new Map<Uuid, string>()
    for (const member of memberships) names.set(member.id, member.displayName)
    return names
  }, [memberships])

  if (ordered.length === 0) {
    return <EmptyState icon="dumbbell" title={t('athlete.noSessionsYet')} description={t('athlete.startFirst')} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-gap)' }} data-testid="history">
      {ordered.map((session) => {
        const volume = progress ? sessionVolume(setsBySession.get(session.id) ?? []) : null
        const author = nameOf.get(sessionAuthorId(session)) ?? null
        return (
          <Card
            key={session.id}
            onClick={() => onOpen(session.id)}
            ariaLabel={`${formatDate(session.localDate, locale)} · ${session.title ?? t('log.title')} — ${t('athlete.openLog')}`}
          >
            <span style={row}>
              <span style={left}>
                <span style={titleStyle}>{session.title ?? t('log.title')}</span>
                <span style={metaStyle}>
                  <span className="num">{formatDate(session.localDate, locale)}</span>
                  {author ? (
                    <>
                      <Icon name="users" size={14} />
                      {author}
                    </>
                  ) : null}
                  {session.status === 'active' ? <span style={liveBadge}>{t('log.live')}</span> : null}
                </span>
              </span>
              <span style={right}>
                {volume !== null && volume > 0 ? (
                  <>
                    <span className="num" style={{ fontSize: 'var(--th-text-md)', color: 'var(--th-ink)' }}>
                      {formatVolume(volume, locale)}
                    </span>
                    <span style={unitStyle}>{t('log.totalVolume')}</span>
                  </>
                ) : null}
              </span>
              <Icon name="chevron" size={18} />
            </span>
          </Card>
        )
      })}
    </div>
  )
}
