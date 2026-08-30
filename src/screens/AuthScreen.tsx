import { useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AuthActionError } from '@/auth/AuthProvider'
import { useAuth } from '@/auth/useAuth'
import { Button, Card, Field, Icon, Input, Screen } from '@/ui'

/**
 * Sign-in. Public route.
 *
 * **Email OTP and nothing else.** There is no Google button, and its absence is a decision
 * rather than an omission: an OAuth redirect launched from a home-screen PWA leaves the
 * standalone window, completes in Safari, and returns the user to an installed app that is
 * still signed out. That is the literal "it logged me out again" complaint this product exists
 * to stop hearing, and the workaround trainers reach for is a shared login. A six-digit code
 * never leaves the app, needs no password anyone can forget, and doubles as the recovery path
 * for a locked-out coach.
 *
 * **And no demo-login button.** When Supabase is unconfigured the app is already running on
 * the seeded local repository, so the honest screen is one that says so and opens the app —
 * not a fake account that pretends a sign-in happened.
 *
 * Every failure here names what went wrong and what to do about it. "Error" on a sign-in
 * screen is indistinguishable from "this app is broken", and the trainer's next move is to
 * ask a colleague for their password.
 */

const titleStyle: CSSProperties = { fontSize: 'var(--th-text-2xl)', margin: 0 }

const leadStyle: CSSProperties = {
  margin: '6px 0 0',
  color: 'var(--th-muted)',
  fontSize: 'var(--th-text-sm)',
  lineHeight: 1.45,
}

const bodyText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-ink)',
  lineHeight: 1.45,
}

const mutedText: CSSProperties = { ...bodyText, color: 'var(--th-muted)' }

const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }

const inviteLink: CSSProperties = {
  color: 'var(--th-accent)',
  fontWeight: 600,
  alignSelf: 'flex-start',
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
}

function Banner({
  tone,
  title,
  body,
}: {
  tone: 'info' | 'bad'
  title: string
  body: string
}) {
  return (
    <div
      role="status"
      style={{
        background: tone === 'bad' ? 'var(--th-danger-soft)' : 'var(--th-surface-2)',
        border: '1px solid var(--th-line)',
        borderRadius: 'var(--th-r-lg)',
        padding: 'var(--th-pad)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <strong style={{ color: tone === 'bad' ? 'var(--th-danger)' : 'var(--th-ink)', fontWeight: 600 }}>
        {title}
      </strong>
      <span style={{ color: 'var(--th-ink)', fontSize: 'var(--th-text-sm)', lineHeight: 1.45 }}>
        {body}
      </span>
    </div>
  )
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/** What a coach can act on, in their own language. The raw gotrue message is not that. */
type Reason =
  | 'auth.codeInvalid'
  | 'auth.codeExpired'
  | 'auth.rateLimited'
  | 'auth.offline'
  | 'auth.emailInvalid'
  | null

function reasonFor(error: unknown): Reason {
  const code = error instanceof AuthActionError ? error.code : null
  const message = error instanceof Error ? error.message.toLowerCase() : ''

  if (code === 'otp_expired' || message.includes('expired')) return 'auth.codeExpired'
  if (code === 'invalid_credentials' || message.includes('invalid') || message.includes('token'))
    return 'auth.codeInvalid'
  if (code?.includes('rate_limit') || message.includes('rate limit')) return 'auth.rateLimited'
  if (code === 'email_address_invalid' || message.includes('email address')) return 'auth.emailInvalid'
  // A fetch that never reached the server. Not a credential problem, and telling a coach
  // their code is wrong when the wifi dropped sends them chasing the wrong thing.
  if (message.includes('fetch') || message.includes('network')) return 'auth.offline'
  return null
}

export function AuthScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { status, missingEnv, error, isDemo, signInWithOtp, verifyOtp } = useAuth()

  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ title: string; body: string } | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * No server, no sign-in — and this must not be a dead end. The local repository is already
   * live and seeded, so the only honest control is one that opens the app.
   */
  const demoMode = isDemo || status === 'unconfigured'

  async function send(address: string, resend: boolean) {
    setBusy(true)
    setBanner(null)
    try {
      await signInWithOtp(address)
      setStep('code')
      setInfo(resend ? t('auth.codeResent') : t('auth.codeSent', { email: address }))
    } catch (caught) {
      const reason = reasonFor(caught)
      setBanner({
        title: t('auth.sendFailed'),
        body: reason ? t(reason) : t('errors.genericBody'),
      })
    } finally {
      setBusy(false)
    }
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault()
    const address = email.trim()
    if (address === '') {
      setFieldError(t('auth.emailRequired'))
      return
    }
    if (!looksLikeEmail(address)) {
      setFieldError(t('auth.emailInvalid'))
      return
    }
    setFieldError(null)
    await send(address, false)
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault()
    const token = code.trim()
    if (token.length < 6) {
      setFieldError(t('auth.codeRequired'))
      return
    }
    setFieldError(null)
    setBusy(true)
    setBanner(null)
    try {
      await verifyOtp(email.trim(), token)
      // The session arrives through onAuthStateChange and the route guard takes over.
    } catch (caught) {
      const reason = reasonFor(caught)
      setBanner({
        title: t('auth.verifyFailed'),
        body: reason ? t(reason) : t('errors.genericBody'),
      })
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <div>
      <h1 className="display" style={titleStyle}>
        {t('auth.title')}
      </h1>
      <p style={leadStyle}>{t('auth.subtitle')}</p>
    </div>
  )

  if (demoMode) {
    return (
      <Screen label={t('auth.title')} header={header}>
        <Banner tone="info" title={t('auth.demoTitle')} body={t('auth.demoBody')} />
        {status === 'unconfigured' && missingEnv.length > 0 ? (
          <p style={mutedText}>{t('auth.notConfiguredBody', { vars: missingEnv.join(', ') })}</p>
        ) : null}
        <Button
          variant="primary"
          block
          icon="sparkle"
          onClick={() => navigate('/athletes', { replace: true })}
        >
          {t('auth.demoEnter')}
        </Button>
        <Link to="/join" style={inviteLink}>
          {t('auth.haveInvite')}
        </Link>
      </Screen>
    )
  }

  return (
    <Screen label={t('auth.title')} header={header}>
      {error ? <Banner tone="bad" title={t('errors.genericTitle')} body={error} /> : null}
      {banner ? <Banner tone="bad" title={banner.title} body={banner.body} /> : null}

      <Card>
        {step === 'email' ? (
          <form onSubmit={(event) => void submitEmail(event)} style={stack}>
            <Field label={t('auth.emailLabel')} required error={fieldError ?? undefined}>
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t('auth.emailPlaceholder')}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  if (fieldError) setFieldError(null)
                }}
              />
            </Field>

            <Button type="submit" variant="primary" block loading={busy} disabled={busy}>
              {t('auth.sendCode')}
            </Button>

            {/* Says why there is no Google button, on the screen where someone looks for it. */}
            <p style={{ ...mutedText, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Icon name="alert" size={18} />
              <span>{t('auth.otpOnly')}</span>
            </p>
          </form>
        ) : (
          <form onSubmit={(event) => void submitCode(event)} style={stack}>
            {info ? <p style={bodyText}>{info}</p> : null}

            <Field
              label={t('auth.codeLabel')}
              hint={t('auth.codeHint')}
              required
              error={fieldError ?? undefined}
            >
              {/* A plain input, not the <Keypad>: `one-time-code` is what lets iOS offer the
                  code from the notification, and there is no decimal comma to mis-parse. */}
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, ''))
                  if (fieldError) setFieldError(null)
                }}
              />
            </Field>

            <Button type="submit" variant="primary" block loading={busy} disabled={busy}>
              {t('auth.verify')}
            </Button>

            <Button
              variant="quiet"
              block
              disabled={busy}
              onClick={() => void send(email.trim(), true)}
            >
              {t('auth.resendCode')}
            </Button>

            <Button
              variant="ghost"
              block
              icon="back"
              disabled={busy}
              onClick={() => {
                setStep('email')
                setCode('')
                setInfo(null)
                setBanner(null)
                setFieldError(null)
              }}
            >
              {t('auth.changeEmail')}
            </Button>
          </form>
        )}
      </Card>

      <Link to="/join" style={inviteLink}>
        {t('auth.haveInvite')}
      </Link>
    </Screen>
  )
}
