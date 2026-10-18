import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import {
  useAthleteAccess,
  useAthleteAccountsSupported,
  useCreateAthleteInvite,
  useRevokeAthleteAccess,
} from '@/data/hooks'
import { ATHLETE_ACCOUNTS_MISSING } from '@/data/repo/types'
import { formatDate } from '@/domain/format'
import { currentLocale } from '@/i18n'
import type { Athlete } from '@/domain/types'
import { Button, Card, Field, Input, Sheet } from '@/ui'

/**
 * "Can this athlete see their own sheet?" — on the athlete's page, where the question comes up.
 *
 * Everyone sees the answer; only the owner can change it, which mirrors 012. A trainer gets
 * the same card with the reason instead of the buttons — a missing button is read as a broken
 * app, and the workaround for a broken app is the owner's password.
 *
 * The link is shown ONCE, exactly like a trainer's invite: the server keeps only its hash.
 * "Share" hands it to Viber or WhatsApp directly, which is how it will travel anyway.
 *
 * Withdrawing access sits apart from sending a link — nothing destructive within a thumb's
 * width of something routine — and needs no confirm: it deletes nothing, and a new link undoes it.
 */

const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }

const heading: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
}

const bodyText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-ink)',
  lineHeight: 1.45,
}

const mutedText: CSSProperties = { ...bodyText, color: 'var(--th-muted)' }

function linkFor(secret: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  // The fragment, never the query string: a `?invite=` link puts a bearer token in access logs.
  return `${origin}/welcome#invite=${encodeURIComponent(secret)}`
}

export function AthleteAccessCard({ athlete }: { athlete: Athlete }) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const { membership } = useAuth()
  const supported = useAthleteAccountsSupported()
  const access = useAthleteAccess(supported ? athlete.id : undefined)
  const revoke = useRevokeAthleteAccess()
  const [sending, setSending] = useState(false)
  const [revokeFailed, setRevokeFailed] = useState(false)

  if (!supported) return null

  const isOwner = membership?.role === 'owner'
  const missing = access.error instanceof Error && access.error.message === ATHLETE_ACCOUNTS_MISSING

  let status: string
  if (access.isPending) status = t('common.loading')
  else if (missing) status = t('athleteAccess.notInstalled')
  else if (access.isError) status = t('athleteAccess.unknown')
  else if (access.data?.linked) status = t('athleteAccess.linked', { email: access.data.email ?? '—' })
  else if (access.data?.pendingExpires)
    status = t('athleteAccess.pending', { date: formatDate(access.data.pendingExpires.slice(0, 10), locale) })
  else status = t('athleteAccess.none')

  return (
    <section style={stack} aria-label={t('athleteAccess.title')}>
      <h2 style={heading}>{t('athleteAccess.title')}</h2>
      <Card>
        <div style={stack}>
          <p style={bodyText} role="status">
            {status}
          </p>
          {missing ? null : isOwner ? (
            <Button variant="secondary" icon="share" block onClick={() => setSending(true)}>
              {access.data?.linked || access.data?.pendingExpires ? t('athleteAccess.sendNew') : t('athleteAccess.send')}
            </Button>
          ) : (
            <p style={mutedText}>{t('athleteAccess.ownerOnly')}</p>
          )}
        </div>
      </Card>

      {isOwner && !missing && (access.data?.linked || access.data?.pendingExpires) ? (
        <Card tone="flat">
          <div style={stack}>
            <p style={mutedText}>{t('athleteAccess.revokeHint')}</p>
            <Button
              variant="dangerQuiet"
              block
              loading={revoke.isPending}
              disabled={revoke.isPending}
              onClick={() =>
                void revoke.mutateAsync(athlete.id).then((state) => setRevokeFailed(state === 'failed'))
              }
            >
              {t('athleteAccess.revoke')}
            </Button>
            {revokeFailed ? (
              <p role="status" style={{ ...bodyText, color: 'var(--th-danger)' }}>
                {t('athleteAccess.revokeFailed')}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      <AthleteInviteSheet athlete={athlete} open={sending} onClose={() => setSending(false)} />
    </section>
  )
}

function AthleteInviteSheet({ athlete, open, onClose }: { athlete: Athlete; open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const create = useCreateAthleteInvite()
  const [email, setEmail] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)

  useEffect(() => {
    if (open) return
    setEmail('')
    setLink(null)
    setError(null)
    setCopied(null)
  }, [open])

  async function mint() {
    setError(null)
    const result = await create.mutateAsync({ athleteId: athlete.id, email: email.trim() || null })
    if (result.state === 'failed' || !result.secret) {
      setError(t('athleteAccess.sendFailed'))
      return
    }
    setLink(linkFor(result.secret))
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied('yes')
    } catch {
      // Denied, or no clipboard API at all. The field is selectable, so this is not a dead end.
      setCopied('no')
    }
  }

  async function share(value: string) {
    try {
      await navigator.share({ title: t('brand.name'), text: t('athleteAccess.shareText', { name: athlete.fullName }), url: value })
    } catch {
      // Cancelled, or refused. The link is still on screen to copy.
    }
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={link ? t('athleteAccess.created') : t('athleteAccess.sendTitle', { name: athlete.fullName })}
      footer={
        link ? (
          <Button variant="primary" block onClick={onClose}>
            {t('common.done')}
          </Button>
        ) : (
          <Button variant="primary" block loading={create.isPending} disabled={create.isPending} onClick={() => void mint()}>
            {t('athleteAccess.create')}
          </Button>
        )
      }
    >
      {link ? (
        <>
          <p style={{ ...bodyText, color: 'var(--th-danger)' }}>
            <strong>{t('team.inviteShownOnce')}</strong>
          </p>
          <p style={mutedText}>{t('athleteAccess.onceWarning')}</p>
          <Field label={t('team.inviteLink')}>
            <Input value={link} readOnly onFocus={(event) => event.currentTarget.select()} />
          </Field>
          {canShare ? (
            <Button variant="secondary" block icon="share" onClick={() => void share(link)}>
              {t('athleteAccess.share')}
            </Button>
          ) : null}
          <Button variant="secondary" block icon="copy" onClick={() => void copy(link)}>
            {t('team.copyLink')}
          </Button>
          {copied === 'yes' ? <p role="status" style={{ ...bodyText, color: 'var(--th-success)' }}>{t('team.linkCopied')}</p> : null}
          {copied === 'no' ? <p role="status" style={{ ...bodyText, color: 'var(--th-danger)' }}>{t('team.copyFailed')}</p> : null}
        </>
      ) : (
        <>
          <p style={mutedText}>{t('athleteAccess.explain')}</p>
          <Field label={t('athleteAccess.emailLabel')} hint={t('athleteAccess.emailHint')} error={error ?? undefined}>
            <Input
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              placeholder={t('auth.emailPlaceholder')}
              onChange={(event) => {
                setEmail(event.target.value)
                if (error) setError(null)
              }}
            />
          </Field>
        </>
      )}
    </Sheet>
  )
}
