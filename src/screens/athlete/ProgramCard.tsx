import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import { useAssignment, useCapabilities, useNextProgramDay, usePrograms, useProgramWrite } from '@/data/hooks'
import { parseSequence } from '@/domain/recap'
import type { Athlete } from '@/domain/types'
import { Button, Card, Chip, Field, Input } from '@/ui'
import { dayLabel } from '@/screens/log/StartFrom'

/**
 * The athlete's programme on their sheet (013): which one they follow, in which order of days,
 * and the day their next workout will offer. Programmes belong to one athlete (#31), so only
 * theirs are offered here; writing one happens on the Προγράμματα screen.
 *
 * Owner-only writes, as 013's RESTRICTIVE policies say; a trainer reads the same card.
 */

const muted: CSSProperties = { margin: 0, fontSize: 'var(--th-text-sm)', color: 'var(--th-muted)', lineHeight: 1.45 }

export function ProgramCard({ athlete }: { athlete: Athlete }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { membership } = useAuth()
  const caps = useCapabilities()
  const programs = usePrograms()
  const assignment = useAssignment(caps.programs ? athlete.id : undefined)
  const next = useNextProgramDay(caps.programs ? athlete.id : undefined)
  const write = useProgramWrite()
  const [order, setOrder] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!caps.programs) return null
  const isOwner = membership?.role === 'owner'
  const own = (programs.data ?? []).filter((p) => p.athleteId === athlete.id)
  const current = assignment.data ? own.find((p) => p.id === assignment.data?.programId) : undefined

  async function saveOrder(programId: string, text: string) {
    const program = own.find((p) => p.id === programId)
    if (!program) return
    try {
      const sequence = parseSequence(text, program.days.map((d) => d.position))
      const state = await write.mutateAsync({ kind: 'assign', athleteId: athlete.id, programId, sequence })
      if (state === 'failed') setError(t('programs.writeFailed'))
      else {
        setOrder(null)
        setError(null)
      }
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : ''
      setError(reason.startsWith('no-day:') ? t('programs.noSuchDay', { day: reason.slice(7) }) : t('programs.badOrder'))
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={t('programs.title')}>
      <h2 style={{ ...muted, fontSize: 'var(--th-text-xs)', letterSpacing: 'var(--th-label-tracking)', textTransform: 'uppercase' }}>
        {t('programs.title')}
      </h2>
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {current && assignment.data ? (
            <>
              <strong>{current.name}</strong>
              <p className="num" style={muted}>
                {t('programs.order')}: {assignment.data.sequence.join('-')}
              </p>
              {next ? (
                <p style={{ ...muted, color: 'var(--th-ink)' }}>
                  {t('programs.nextDay', { day: dayLabel(t('programs.day'), next.day.position, next.day.name) })}
                </p>
              ) : null}
            </>
          ) : (
            <p style={muted}>{t('programs.noneAssigned')}</p>
          )}

          {isOwner && own.length > 0 ? (
            <div role="group" aria-label={t('programs.choose')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {own.map((p) => (
                <Chip
                  key={p.id}
                  selected={p.id === current?.id}
                  onClick={() =>
                    void write.mutateAsync({
                      kind: 'assign',
                      athleteId: athlete.id,
                      programId: p.id,
                      sequence: p.days.map((d) => d.position),
                    })
                  }
                >
                  {p.name}
                </Chip>
              ))}
            </div>
          ) : null}

          {isOwner && current ? (
            order === null ? (
              <Button variant="quiet" onClick={() => setOrder(assignment.data?.sequence.join('-') ?? '')}>
                {t('programs.changeOrder')}
              </Button>
            ) : (
              <>
                <Field label={t('programs.order')} hint={t('programs.orderHint')} error={error ?? undefined}>
                  <Input value={order} inputMode="numeric" onChange={(event) => setOrder(event.target.value)} />
                </Field>
                <Button variant="primary" loading={write.isPending} onClick={() => void saveOrder(current.id, order)}>
                  {t('common.save')}
                </Button>
              </>
            )
          ) : null}

          <Button variant="secondary" onClick={() => navigate(`/programs?athlete=${athlete.id}`)}>
            {isOwner ? t('programs.manage') : t('programs.view')}
          </Button>
          {!isOwner ? <p style={muted}>{t('programs.ownerOnly')}</p> : null}
        </div>
      </Card>
    </section>
  )
}
