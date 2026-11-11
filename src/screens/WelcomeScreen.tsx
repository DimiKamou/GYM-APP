import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import { readInviteSecretFromHash, readStash, stripFragment, writeStash } from '@/auth/inviteStash'
import { useRedeemAthleteInvite } from '@/data/hooks'
import type { AthleteRedeemOutcome } from '@/data/repo/types'
import { Button, Card, Field, Input, Screen, Spinner } from '@/ui'

/**
 * An athlete's link: `/welcome#invite=<secret>`. Public route.
 *
 * Same handling of the secret as `/join` — fragment only, stripped before the first paint,
 * stashed per tab for the trip through sign-in — and a different RPC at the end:
 * `redeem_athlete_invite`, which links this account to one athlete's sheet and to nothing else.
 *
 * Redeeming is a button, not automatic, and the button names the account it will link. A
 * phone is shared at home as often as at the gym, and a link spent on a sibling's Google
 * account is a link the owner has to send again.
 *
 * Also where an account lands that is signed in and belongs nowhere — typically an athlete
 * who signed up before opening the link — so it says what to do instead of showing a roster
 * they cannot read.
 */

const titleStyle: CSSProperties = { fontSize: 'var(--th-text-2xl)', margin: 0 }

const bodyText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-ink)',
  lineHeight: 1.45,
}

const mutedText: CSSProperties = { ...bodyText, color: 'var(--th-muted)' }

const cardStack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }

type Phase = 'idle' | 'invalid' | 'staff'

export function WelcomeScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { status, user, isDemo, reload, signOut, setDemoPersona } = useAuth()
  const redeem = useRedeemAthleteInvite()

  const [secret] = useState<string | null>(() => readInviteSecretFromHash() ?? readStash('athlete'))
  const [typed, setTyped] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [fieldError, setFieldError] = useState<string | null>(null)

  // Before the browser paints, so the address bar never renders a frame with the secret in it.
  useLayoutEffect(() => {
    if (window.location.hash) stripFragment()
  }, [])

  useEffect(() => {
    if (secret) writeStash('athlete', secret)
  }, [secret])

  const signedIn = status === 'ready' || status === 'no-membership' || status === 'athlete'

  async function link(candidate: string): Promise<void> {
    const value = candidate.trim()
    if (value === '') {
      setFieldError(t('welcome.codeRequired'))
      return
    }
    setFieldError(null)
    let outcome: AthleteRedeemOutcome = { ok: false }
    try {
      outcome = await redeem.mutateAsync(value)
    } catch {
      outcome = { ok: false }
    }
    if (!outcome.ok) {
      setPhase(outcome.staff ? 'staff' : 'invalid')
      return
    }
    writeStash('athlete', null)
    // The demo has no account to re-resolve; it switches sides instead.
    if (isDemo) setDemoPersona('athlete')
    else await reload()
    navigate('/me', { replace: true })
  }

  const header = (
    <div>
      <h1 className="display" style={titleStyle}>
        {t('welcome.title')}
      </h1>
      <p style={{ ...mutedText, marginTop: 4 }}>{t('welcome.subtitle')}</p>
    </div>
  )

  if (status === 'loading') {
    return (
      <Screen label={t('welcome.title')} header={header}>
        <Spinner label={t('auth.checkingSession')} />
      </Screen>
    )
  }

  // An athlete who opens an old link again is already where it leads.
  if (status === 'athlete' && !secret) {
    return (
      <Screen label={t('welcome.title')} header={header}>
        <Button variant="primary" block icon="sparkle" onClick={() => navigate('/me', { replace: true })}>
          {t('welcome.openSheet')}
        </Button>
      </Screen>
    )
  }

  return (
    <Screen label={t('welcome.title')} header={header}>
      <Card>
        {/* The secret itself is never rendered — a screenshot of this screen must not be a
            working link. Only whether one arrived. */}
        <div role="status" style={cardStack}>
          <strong style={{ fontWeight: 600 }}>{secret ? t('welcome.linkReceived') : t('welcome.noLink')}</strong>
          {secret && !signedIn ? <span style={mutedText}>{t('welcome.signInFirst')}</span> : null}
          {secret && signedIn && user?.email ? (
            <span style={mutedText}>{t('welcome.linkAs', { email: user.email })}</span>
          ) : null}
          {!secret ? <span style={mutedText}>{t('welcome.noLinkHint')}</span> : null}
        </div>
      </Card>

      {phase === 'invalid' ? (
        <Card tone="flat">
          <div role="status" style={cardStack}>
            <strong style={{ fontWeight: 600, color: 'var(--th-danger)' }}>{t('welcome.invalid')}</strong>
            <span style={mutedText}>{t('welcome.invalidHint')}</span>
          </div>
        </Card>
      ) : null}

      {phase === 'staff' ? (
        <Card tone="flat">
          <div role="status" style={cardStack}>
            <strong style={{ fontWeight: 600, color: 'var(--th-danger)' }}>{t('welcome.staffTitle')}</strong>
            <span style={mutedText}>{t('welcome.staffBody')}</span>
          </div>
        </Card>
      ) : null}

      {!signedIn && !isDemo ? (
        <Button variant="primary" block onClick={() => navigate('/login')}>
          {t('welcome.signInOrUp')}
        </Button>
      ) : secret ? (
        <Button
          variant="primary"
          block
          icon="check"
          loading={redeem.isPending}
          disabled={redeem.isPending}
          onClick={() => void link(secret)}
        >
          {t('welcome.submit')}
        </Button>
      ) : (
        <>
          <Field label={t('welcome.codeLabel')} hint={t('join.codeHint')} error={fieldError ?? undefined}>
            <Input
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value)
                if (fieldError) setFieldError(null)
                if (phase !== 'idle') setPhase('idle')
              }}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>
          <Button
            variant="primary"
            block
            icon="check"
            loading={redeem.isPending}
            disabled={redeem.isPending}
            onClick={() => void link(typed)}
          >
            {t('welcome.submit')}
          </Button>
        </>
      )}

      {signedIn && !isDemo ? (
        <Button variant="ghost" block icon="offline" onClick={() => void signOut()}>
          {t('welcome.notYou')}
        </Button>
      ) : null}

      <Link
        to="/join"
        style={{ color: 'var(--th-accent)', fontWeight: 600, minHeight: 44, display: 'flex', alignItems: 'center' }}
      >
        {t('welcome.trainerInstead')}
      </Link>
    </Screen>
  )
}
