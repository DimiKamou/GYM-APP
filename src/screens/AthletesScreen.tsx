import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueries, useQueryClient } from '@tanstack/react-query'

import { useGymId } from '@/auth/useAuth'
import { keys } from '@/data/keys'
import { useAthletes, useRepo } from '@/data/hooks'
import { compareSessions } from '@/domain/analytics'
import { formatDate } from '@/domain/format'
import { matches } from '@/domain/text'
import { currentLocale } from '@/i18n'
import type { Athlete, LocalDate, Session, Uuid } from '@/domain/types'
import { Avatar, Button, Card, EmptyState, Icon, Input, Screen, Spinner } from '@/ui'
import { AthleteSheet } from '@/screens/athlete/AthleteSheet'

/**
 * The roster.
 *
 * Search is done HERE, over the whole roster, rather than by refetching per keystroke. Both
 * repositories fetch every athlete and filter with `matches()` anyway — Postgres' `ilike` is
 * neither accent- nor final-sigma-insensitive — so a per-keystroke query would mint a cache
 * entry per prefix and buy nothing. One list, folded locally: "παπαδακησ" finds "Παπαδάκης"
 * with the final sigma the phone keyboard produced and none of the accents a coach skips.
 */

const headerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 12,
}

const searchWrap: CSSProperties = { position: 'relative', display: 'flex' }

const searchIcon: CSSProperties = {
  position: 'absolute',
  left: 13,
  top: '50%',
  transform: 'translateY(-50%)',
  color: 'var(--th-faint)',
  pointerEvents: 'none',
  display: 'flex',
}

const rowInner: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  width: '100%',
  textAlign: 'left',
}

const nameCol: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: '1 1 auto' }

const nameStyle: CSSProperties = {
  fontSize: 'var(--th-text-md)',
  fontWeight: 600,
  color: 'var(--th-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const goalStyle: CSSProperties = {
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const metaCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 2,
  flex: '0 0 auto',
}

const metaLabel: CSSProperties = {
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-faint)',
}

export function AthletesScreen() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const navigate = useNavigate()
  const gymId = useGymId()
  const repo = useRepo()
  const client = useQueryClient()

  const [search, setSearch] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)

  const roster = useAthletes()
  const athletes = useMemo(() => roster.data ?? [], [roster.data])

  /**
   * The last session per athlete, one query each.
   *
   * The repository has no roster-with-last-session read, and inventing one here would mean a
   * screen reaching past the contract. Each entry shares the key the detail screen uses, so
   * opening an athlete costs no second fetch. If a gym's roster ever outgrows one screen this
   * is the place a single server-side view pays for itself.
   */
  const sessionQueries = useQueries({
    queries: athletes.map((athlete) => ({
      queryKey: keys.athleteSessions(gymId, athlete.id),
      queryFn: () => repo.listAthleteSessions(gymId, athlete.id),
      staleTime: 60_000,
    })),
  })

  // Not memoised: `useQueries` hands back a fresh array every render, so a memo keyed on it
  // would recompute anyway and only look like it did not.
  const lastSessionByAthlete = new Map<Uuid, LocalDate | null>()
  athletes.forEach((athlete, index) => {
    const result = sessionQueries[index]
    if (!result || result.data === undefined) return
    lastSessionByAthlete.set(athlete.id, latestDate(result.data))
  })

  const filtered = useMemo(
    () => athletes.filter((athlete) => matches(athlete.fullName, search)),
    [athletes, search],
  )

  const open = (athlete: Athlete) => navigate(`/athletes/${athlete.id}`)

  /** The briefing is the next screen's whole point, so it starts loading on the press. */
  const prefetch = (athlete: Athlete) =>
    void client.prefetchQuery({
      queryKey: keys.briefing(gymId, athlete.id),
      queryFn: () => repo.getBriefing(gymId, athlete.id),
    })

  return (
    <Screen
      label={t('athletes.title')}
      header={
        <>
          <div style={headerRow}>
            <h1 className="display" style={{ fontSize: 'var(--th-text-2xl)', margin: 0 }}>
              {t('athletes.title')}
            </h1>
            <Button
              variant="primary"
              icon="plus"
              aria-label={t('athletes.add')}
              onClick={() => setSheetOpen(true)}
            />
          </div>
          <div style={searchWrap}>
            <span style={searchIcon} aria-hidden="true">
              <Icon name="search" size={18} />
            </span>
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('athletes.searchPlaceholder')}
              aria-label={t('athletes.searchPlaceholder')}
              style={{ paddingLeft: 40 }}
            />
          </div>
        </>
      }
    >
      {roster.isPending ? <Spinner label={t('common.loading')} /> : null}

      {!roster.isPending && athletes.length === 0 ? (
        <EmptyState
          icon="athletes"
          title={t('athletes.empty')}
          description={t('athletes.emptyHint')}
          action={
            <Button variant="primary" icon="plus" onClick={() => setSheetOpen(true)}>
              {t('athletes.add')}
            </Button>
          }
        />
      ) : null}

      {athletes.length > 0 && filtered.length === 0 ? (
        <EmptyState
          icon="search"
          title={t('athletes.noMatches')}
          description={t('athletes.noMatchesHint')}
          action={
            <Button icon="x" onClick={() => setSearch('')}>
              {t('athletes.clearSearch')}
            </Button>
          }
        />
      ) : null}

      {filtered.map((athlete) => {
        const last = lastSessionByAthlete.get(athlete.id)
        return (
          <div key={athlete.id} onPointerDown={() => prefetch(athlete)}>
            <Card onClick={() => open(athlete)}>
              <span style={rowInner}>
                <Avatar fullName={athlete.fullName} />
                <span style={nameCol}>
                  <span style={nameStyle}>{athlete.fullName}</span>
                  <span style={goalStyle}>
                    {athlete.planFocus ?? athlete.planPhase ?? t('athlete.goal')}
                  </span>
                </span>
                <span style={metaCol}>
                  <span style={metaLabel}>{t('athletes.lastSession')}</span>
                  {last ? (
                    <span className="num" style={{ fontSize: 'var(--th-text-sm)', color: 'var(--th-ink)' }}>
                      {formatDate(last, locale)}
                    </span>
                  ) : (
                    <span style={{ fontSize: 'var(--th-text-sm)', color: 'var(--th-faint)' }}>
                      {last === null ? t('athletes.noPrevious') : '—'}
                    </span>
                  )}
                </span>
              </span>
            </Card>
          </div>
        )
      })}

      <AthleteSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCreated={(athleteId) => navigate(`/athletes/${athleteId}`)}
      />
    </Screen>
  )
}

/**
 * The date of the most recent session, by the total order in `@/domain/analytics`.
 *
 * Not `rows[0].localDate`: the local repository happens to return them newest-first and the
 * Supabase one orders on the server, and a roster that trusts either would print the wrong
 * date the day one of them changes.
 */
function latestDate(sessions: readonly Session[]): LocalDate | null {
  let latest: Session | null = null
  for (const session of sessions) {
    if (session.deletedAt !== null) continue
    if (!latest || compareSessions(session, latest) > 0) latest = session
  }
  return latest ? latest.localDate : null
}
