import { useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AuthActionError, type OAuthProvider } from '@/auth/AuthProvider'
import { useAuth } from '@/auth/useAuth'
import { Button, Card, Field, Input, Screen, Segmented } from '@/ui'
import { ProviderLogo } from '@/ui/ProviderLogo'

/**
 * Sign-in. Public route.
 *
 * Two kinds of people arrive here and the screen is laid out for the order they come in:
 *
 *  - **An athlete**, holding a link from the gym. Google and Microsoft come first, because an
 *    athlete has a Gmail or an Outlook and no reason to invent a password for their gym; below
 *    them, "Εγγραφή" for one who has neither. The provider buttons are absent in an iOS
 *    home-screen app (see AuthProvider) rather than present and broken.
 *  - **A trainer**, with the username and password the Streamlit pilot gave them. "dimitris"
 *    is enough; the app adds the domain exactly as Streamlit does.
 *
 * The email code stays, one tap away, as the recovery path for anyone with a real address.
 *
 * **No demo-login button.** When Supabase is unconfigured the app is already running on the
 * seeded local repository, so the honest screen is one that says so and opens the app.
 *
 * Every failure names what went wrong and what to do about it. "Error" on a sign-in screen is
 * indistinguishable from "this app is broken", and the next move is to borrow a colleague's
 * password.
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

const providerLabel: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 10 }

const divider: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  color: 'var(--th-faint)',
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
}

const rule: CSSProperties = { flex: '1 1 auto', height: 1, background: 'var(--th-line)' }

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

/** gotrue's own minimum is 6; eight is what a gym's front desk can still remember. */
const MIN_PASSWORD = 8

/** What a person can act on, in their own language. The raw gotrue message is not that. */
type Reason =
  | 'auth.codeInvalid'
  | 'auth.codeExpired'
  | 'auth.rateLimited'
  | 'auth.offline'
  | 'auth.emailInvalid'
  | 'auth.wrongPassword'
  | 'auth.emailNotConfirmed'
  | 'auth.alreadyRegistered'
  | 'auth.weakPassword'
  | 'auth.signupDisabled'
  | 'auth.usernameInvalid'
  | null

function reasonFor(error: unknown, mode: 'code' | 'password' = 'code'): Reason {
  const code = error instanceof AuthActionError ? error.code : null
  const message = error instanceof Error ? error.message.toLowerCase() : ''

  if (code === 'identifier_username') return 'auth.usernameInvalid'
  if (code === 'email_not_confirmed' || message.includes('not confirmed')) return 'auth.emailNotConfirmed'
  if (code === 'user_already_exists' || message.includes('already registered')) return 'auth.alreadyRegistered'
  if (code === 'weak_password' || message.includes('weak')) return 'auth.weakPassword'
  if (code === 'signup_disabled' || message.includes('signups not allowed')) return 'auth.signupDisabled'
  if (code === 'otp_expired' || message.includes('expired')) return 'auth.codeExpired'
  if (code === 'invalid_credentials' || message.includes('invalid') || message.includes('token'))
    return mode === 'password' ? 'auth.wrongPassword' : 'auth.codeInvalid'
  if (code?.includes('rate_limit') || message.includes('rate limit')) return 'auth.rateLimited'
  if (code === 'email_address_invalid' || message.includes('email address')) return 'auth.emailInvalid'
  // A fetch that never reached the server. Not a credential problem, and telling someone their
  // password is wrong when the wifi dropped sends them chasing the wrong thing.
  if (message.includes('fetch') || message.includes('network')) return 'auth.offline'
  return null
}

type Mode = 'signin' | 'signup' | 'otp'

/** The code step is shared: an email sign-in code and a sign-up confirmation are both six digits. */
type CodeStep = { email: string; kind: 'email' | 'signup' } | null

export function AuthScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const {
    status,
    missingEnv,
    error,
    isDemo,
    oauthProviders,
    signInWithOtp,
    verifyOtp,
    signInWithPassword,
    signUpWithPassword,
    signInWithProvider,
  } = useAuth()

  const [mode, setMode] = useState<Mode>('signin')
  const [codeStep, setCodeStep] = useState<CodeStep>(null)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<{ title: string; body: string } | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * No server, no sign-in — and this must not be a dead end. The local repository is already
   * live and seeded, so the only honest control is one that opens the app.
   */
  const demoMode = isDemo || status === 'unconfigured'

  const clearErrors = (field?: string) => {
    if (field && fieldErrors[field]) setFieldErrors(({ [field]: _gone, ...rest }) => rest)
    if (banner) setBanner(null)
  }

  async function attempt(run: () => Promise<void>, failTitle: string, reasonMode: 'code' | 'password') {
    setBusy(true)
    setBanner(null)
    try {
      await run()
    } catch (caught) {
      const reason = reasonFor(caught, reasonMode)
      setBanner({ title: failTitle, body: reason ? t(reason) : t('errors.genericBody') })
    } finally {
      setBusy(false)
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault()
    const errors: Record<string, string> = {}
    if (identifier.trim() === '') errors.identifier = t('auth.identifierRequired')
    if (password === '') errors.password = t('auth.passwordRequired')
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return
    // The session arrives through onAuthStateChange and the route guard takes over.
    await attempt(() => signInWithPassword(identifier, password), t('auth.signInFailed'), 'password')
  }

  async function submitSignUp(event: FormEvent) {
    event.preventDefault()
    const errors: Record<string, string> = {}
    if (fullName.trim() === '') errors.fullName = t('auth.nameRequired')
    if (email.trim() === '') errors.email = t('auth.emailRequired')
    else if (!looksLikeEmail(email)) errors.email = t('auth.emailInvalid')
    if (password.length < MIN_PASSWORD) errors.password = t('auth.passwordTooShort', { min: MIN_PASSWORD })
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return
    await attempt(
      async () => {
        const { needsCode } = await signUpWithPassword({ email, password, fullName })
        if (needsCode) {
          setCodeStep({ email: email.trim(), kind: 'signup' })
          setInfo(t('auth.signUpCodeSent', { email: email.trim() }))
        }
      },
      t('auth.signUpFailed'),
      'password',
    )
  }

  async function sendCode(address: string, resend: boolean) {
    await attempt(
      async () => {
        await signInWithOtp(address)
        setCodeStep({ email: address, kind: 'email' })
        setInfo(resend ? t('auth.codeResent') : t('auth.codeSent', { email: address }))
      },
      t('auth.sendFailed'),
      'code',
    )
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault()
    const address = email.trim()
    if (address === '') {
      setFieldErrors({ email: t('auth.emailRequired') })
      return
    }
    if (!looksLikeEmail(address)) {
      setFieldErrors({ email: t('auth.emailInvalid') })
      return
    }
    setFieldErrors({})
    await sendCode(address, false)
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault()
    if (!codeStep) return
    const token = code.trim()
    if (token.length < 6) {
      setFieldErrors({ code: t('auth.codeRequired') })
      return
    }
    setFieldErrors({})
    await attempt(() => verifyOtp(codeStep.email, token, codeStep.kind), t('auth.verifyFailed'), 'code')
  }

  async function provider(which: OAuthProvider) {
    // Resolves only when the redirect could not start; on success the page is already leaving.
    await attempt(
      () => signInWithProvider(which),
      t('auth.providerFailed', { provider: which === 'google' ? 'Google' : 'Microsoft' }),
      'code',
    )
  }

  const header = (
    <div>
      <h1 className="display" style={titleStyle}>
        {t('brand.name')}
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

  if (codeStep) {
    return (
      <Screen label={t('auth.title')} header={header}>
        {banner ? <Banner tone="bad" title={banner.title} body={banner.body} /> : null}
        <Card>
          <form onSubmit={(event) => void submitCode(event)} style={stack}>
            {info ? <p style={bodyText}>{info}</p> : null}
            <Field label={t('auth.codeLabel')} hint={t('auth.codeHint')} required error={fieldErrors.code}>
              {/* A plain input, not the <Keypad>: `one-time-code` is what lets the phone offer
                  the code from the notification, and there is no decimal comma to mis-parse. */}
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, ''))
                  clearErrors('code')
                }}
              />
            </Field>

            <Button type="submit" variant="primary" block loading={busy} disabled={busy}>
              {t('auth.verify')}
            </Button>

            {codeStep.kind === 'email' ? (
              <Button variant="quiet" block disabled={busy} onClick={() => void sendCode(codeStep.email, true)}>
                {t('auth.resendCode')}
              </Button>
            ) : null}

            <Button
              variant="ghost"
              block
              icon="back"
              disabled={busy}
              onClick={() => {
                setCodeStep(null)
                setCode('')
                setInfo(null)
                setBanner(null)
                setFieldErrors({})
              }}
            >
              {t('auth.changeEmail')}
            </Button>
          </form>
        </Card>
      </Screen>
    )
  }

  return (
    <Screen label={t('auth.title')} header={header}>
      {error ? <Banner tone="bad" title={t('errors.genericTitle')} body={error} /> : null}
      {banner ? <Banner tone="bad" title={banner.title} body={banner.body} /> : null}

      {oauthProviders.length > 0 ? (
        <>
          <div style={stack}>
            {oauthProviders.map((which) => (
              <Button key={which} variant="secondary" block disabled={busy} onClick={() => void provider(which)}>
                <span style={providerLabel}>
                  <ProviderLogo provider={which} />
                  {which === 'google' ? t('auth.continueWithGoogle') : t('auth.continueWithMicrosoft')}
                </span>
              </Button>
            ))}
          </div>
          <div style={divider} aria-hidden="true">
            <span style={rule} />
            {t('common.or')}
            <span style={rule} />
          </div>
        </>
      ) : null}

      {mode !== 'otp' ? (
        <Segmented
          label={t('auth.modeLabel')}
          value={mode}
          options={[
            { value: 'signin', label: t('auth.modeSignIn') },
            { value: 'signup', label: t('auth.modeSignUp') },
          ]}
          onChange={(next) => {
            setMode(next)
            setFieldErrors({})
            setBanner(null)
          }}
        />
      ) : null}

      <Card>
        {mode === 'signin' ? (
          <form onSubmit={(event) => void submitPassword(event)} style={stack}>
            <Field
              label={t('auth.identifierLabel')}
              hint={t('auth.identifierHint')}
              required
              error={fieldErrors.identifier}
            >
              <Input
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={identifier}
                onChange={(event) => {
                  setIdentifier(event.target.value)
                  clearErrors('identifier')
                }}
              />
            </Field>
            <Field label={t('auth.passwordLabel')} required error={fieldErrors.password}>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  clearErrors('password')
                }}
              />
            </Field>
            <Button type="submit" variant="primary" block loading={busy} disabled={busy}>
              {t('auth.signIn')}
            </Button>
          </form>
        ) : mode === 'signup' ? (
          <form onSubmit={(event) => void submitSignUp(event)} style={stack}>
            <p style={mutedText}>{t('auth.signUpHint')}</p>
            <Field label={t('auth.yourName')} required error={fieldErrors.fullName}>
              <Input
                autoComplete="name"
                value={fullName}
                onChange={(event) => {
                  setFullName(event.target.value)
                  clearErrors('fullName')
                }}
              />
            </Field>
            <Field label={t('auth.emailLabel')} required error={fieldErrors.email}>
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
                  clearErrors('email')
                }}
              />
            </Field>
            <Field
              label={t('auth.passwordLabel')}
              hint={t('auth.passwordHint', { min: MIN_PASSWORD })}
              required
              error={fieldErrors.password}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  clearErrors('password')
                }}
              />
            </Field>
            <Button type="submit" variant="primary" block loading={busy} disabled={busy}>
              {t('auth.createAccount')}
            </Button>
          </form>
        ) : (
          <form onSubmit={(event) => void submitEmail(event)} style={stack}>
            <Field label={t('auth.emailLabel')} required error={fieldErrors.email}>
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
                  clearErrors('email')
                }}
              />
            </Field>
            <Button type="submit" variant="primary" block loading={busy} disabled={busy}>
              {t('auth.sendCode')}
            </Button>
            <p style={mutedText}>{t('auth.otpHint')}</p>
          </form>
        )}
      </Card>

      <Button
        variant="ghost"
        block
        disabled={busy}
        onClick={() => {
          setMode(mode === 'otp' ? 'signin' : 'otp')
          setFieldErrors({})
          setBanner(null)
        }}
      >
        {mode === 'otp' ? t('auth.usePassword') : t('auth.useEmailCode')}
      </Button>

      <Link to="/join" style={inviteLink}>
        {t('auth.haveInvite')}
      </Link>
    </Screen>
  )
}
