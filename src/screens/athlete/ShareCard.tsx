import { useMemo, useState, type CSSProperties } from 'react'
import qrcode from 'qrcode-generator'
import { useTranslation } from 'react-i18next'

import { useCapabilities, useShare, useShareWrite } from '@/data/hooks'
import type { SharePeriod } from '@/data/repo/types'
import { formatDate } from '@/domain/format'
import type { Athlete, AthleteShare } from '@/domain/types'
import { currentLocale } from '@/i18n'
import { Button, Card, Field, Input, Segmented } from '@/ui'

/**
 * «Κοινοποίηση προόδου»: a read-only link to this athlete's progress for a period the coach
 * chooses (013/014), for the athlete or a parent — no sign-in. Shown as a QR code on the coach's
 * screen, or handed to the share sheet. The period lives in the database, so a forwarded link
 * cannot be edited into showing more; the same link can be given another period later.
 *
 * Any member may share an athlete and take the link back, as 013's policies say.
 */

type PeriodKind = '1m' | '3m' | '6m' | '1y' | 'custom'

const DAYS: Record<Exclude<PeriodKind, 'custom'>, number> = { '1m': 30, '3m': 91, '6m': 182, '1y': 365 }

const mutedText: CSSProperties = { margin: 0, fontSize: 'var(--th-text-sm)', color: 'var(--th-muted)', lineHeight: 1.45 }

export function shareLink(token: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/share/${token}`
}

function kindOf(share: AthleteShare | null | undefined): PeriodKind {
  if (!share) return '3m'
  if (share.fromDate) return 'custom'
  const found = (Object.keys(DAYS) as Array<keyof typeof DAYS>).find((k) => DAYS[k] === share.periodDays)
  return found ?? '1y'
}

function QrCode({ text, label }: { text: string; label: string }) {
  const src = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    return qr.createDataURL(6, 2)
  }, [text])
  return <img src={src} alt={label} width={196} height={196} style={{ alignSelf: 'center', imageRendering: 'pixelated', background: '#fff', borderRadius: 8 }} />
}

export function ShareCard({ athlete }: { athlete: Athlete }) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const caps = useCapabilities()
  const share = useShare(caps.programs ? athlete.id : undefined)
  const write = useShareWrite()
  const [kind, setKind] = useState<PeriodKind | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (!caps.programs) return null

  const active = share.data ?? null
  const chosen = kind ?? kindOf(active)
  const link = active ? shareLink(active.token) : null

  function period(): SharePeriod | null {
    if (chosen !== 'custom') return { periodDays: DAYS[chosen], fromDate: null, toDate: null }
    if (!from || !to) {
      setError(t('share.pickRange'))
      return null
    }
    if (from > to) {
      setError(t('share.rangeBackwards'))
      return null
    }
    return { periodDays: null, fromDate: from, toDate: to }
  }

  async function save() {
    setError(null)
    const p = period()
    if (!p) return
    const state = active
      ? await write.mutateAsync({ kind: 'period', athleteId: athlete.id, token: active.token, period: p })
      : await write.mutateAsync({ kind: 'create', athleteId: athlete.id, period: caps.sharePeriods ? p : null })
    if (state === 'failed') setError(t('share.failed'))
    setKind(null)
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const periodText = active
    ? active.fromDate && active.toDate
      ? `${formatDate(active.fromDate, locale)} – ${formatDate(active.toDate, locale)}`
      : t(`share.period_${kindOf(active)}`)
    : null

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={t('share.title')}>
      <h2 style={{ ...mutedText, fontSize: 'var(--th-text-xs)', letterSpacing: 'var(--th-label-tracking)', textTransform: 'uppercase' }}>
        {t('share.title')}
      </h2>
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={mutedText}>{active ? t('share.activeFor', { period: periodText }) : t('share.none')}</p>
          {link ? (
            <>
              <QrCode text={link} label={t('share.qr')} />
              <Field label={t('share.link')}>
                <Input value={link} readOnly onFocus={(event) => event.currentTarget.select()} />
              </Field>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="secondary" icon="copy" onClick={() => void copy(link)}>
                  {copied ? t('team.linkCopied') : t('team.copyLink')}
                </Button>
                {typeof navigator !== 'undefined' && typeof navigator.share === 'function' ? (
                  <Button
                    variant="secondary"
                    icon="share"
                    onClick={() => void navigator.share({ title: t('share.title'), text: athlete.fullName, url: link }).catch(() => undefined)}
                  >
                    {t('athleteAccess.share')}
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}

          {caps.sharePeriods || !active ? (
            <>
              <Segmented
                label={t('share.period')}
                value={chosen}
                options={(['1m', '3m', '6m', '1y', 'custom'] as const).map((value) => ({ value, label: t(`share.period_${value}`) }))}
                onChange={(value) => setKind(value)}
              />
              {chosen === 'custom' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Field label={t('share.from')}>
                    <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                  </Field>
                  <Field label={t('share.to')}>
                    <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                  </Field>
                </div>
              ) : null}
              <Button variant="primary" loading={write.isPending} disabled={write.isPending} onClick={() => void save()}>
                {active ? t('share.changePeriod') : t('share.create')}
              </Button>
            </>
          ) : null}
          {error ? <p role="status" style={{ ...mutedText, color: 'var(--th-danger)' }}>{error}</p> : null}
        </div>
      </Card>
      {active ? (
        <Card tone="flat">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={mutedText}>{t('share.revokeHint')}</p>
            <Button
              variant="dangerQuiet"
              loading={write.isPending}
              onClick={() => void write.mutateAsync({ kind: 'revoke', athleteId: athlete.id, token: active.token })}
            >
              {t('share.revoke')}
            </Button>
          </div>
        </Card>
      ) : null}
    </section>
  )
}
