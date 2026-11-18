import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { useMyProgram } from '@/data/hooks'
import { nextProgramStep, targetText } from '@/domain/recap'
import type { PortalProgram } from '@/domain/types'
import { currentLocale } from '@/i18n'
import { Card, EmptyState, Spinner } from '@/ui'
import { dayLabel } from '@/screens/log/StartFrom'

/**
 * The athlete's Πρόγραμμα tab: the programme their coach gave them, in the order they train it,
 * with the day their next workout will be and each day's targets — «Goblet Squat · 3×12 · 20 kg».
 * Read through my_athlete_program() (016), which carries no remark the owner wrote for the staff.
 */

const label: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
}

const stepChip = (next: boolean): CSSProperties => ({
  minWidth: 36,
  height: 36,
  padding: '0 10px',
  borderRadius: 'var(--th-r-pill)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  fontSize: 'var(--th-text-sm)',
  background: next ? 'var(--th-brand-soft)' : 'var(--th-surface-2)',
  border: `1px solid ${next ? 'var(--th-brand)' : 'var(--th-line)'}`,
  color: 'var(--th-ink)',
})

/** Whether the portal should offer the tab at all: not on a database before 016. */
export function useHasProgramTab(): boolean {
  const program = useMyProgram()
  return program.data !== 'unavailable'
}

export function ProgramTab() {
  const { t } = useTranslation()
  const program = useMyProgram()
  if (program.isPending) return <Spinner label={t('common.loading')} />
  const data = program.data
  if (!data || data === 'unavailable') return <EmptyState icon="dumbbell" title={t('portal.programNone')} />
  return <ProgramView program={data} />
}

export function ProgramView({ program }: { program: PortalProgram }) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const step = nextProgramStep(program.sequence, program.lastStep)
  const nextPosition = program.sequence[step]

  return (
    <>
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong style={{ fontSize: 'var(--th-text-lg)' }}>{program.name}</strong>
          <p style={label}>{t('portal.programOrder')}</p>
          <ol aria-label={t('portal.programOrder')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: 0, padding: 0, listStyle: 'none' }}>
            {program.sequence.map((position, index) => (
              <li key={index} className="num" style={stepChip(index === step)} aria-current={index === step ? 'step' : undefined}>
                {position}
              </li>
            ))}
          </ol>
        </div>
      </Card>

      {program.days.map((day) => {
        const isNext = day.position === nextPosition
        return (
          <Card key={day.id}>
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-label={dayLabel(t('programs.day'), day.position, day.name)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <strong>{dayLabel(t('programs.day'), day.position, day.name)}</strong>
                {isNext ? (
                  <span style={{ ...label, color: 'var(--th-brand)', fontWeight: 700 }}>{t('portal.programNext')}</span>
                ) : null}
              </div>
              {day.items.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--th-faint)', fontSize: 'var(--th-text-sm)' }}>{t('portal.programEmptyDay')}</p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {day.items.map((item) => (
                    <li key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 'var(--th-text-sm)' }}>
                      <span style={{ minWidth: 0 }}>
                        {item.nameEn ?? item.nameEl ?? '—'}
                        {item.equipment ? (
                          <span style={{ color: 'var(--th-muted)' }}> · {t(`equipmentTypes.${item.equipment}`)}</span>
                        ) : null}
                      </span>
                      <span className="num" style={{ fontWeight: 650, whiteSpace: 'nowrap' }}>
                        {targetText({ ...item, note: null }, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </Card>
        )
      })}
    </>
  )
}
