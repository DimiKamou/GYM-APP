import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import { useRedeemInvite, type RedeemOutcome } from '@/data/hooks'
import { Button, Card, Field, Input, Screen, Spinner } from '@/ui'

/**
 * Invite redemption. Public route — by definition the person opening it is not a member yet.
 *
 * **The secret travels in the fragment, never the query string.** A fragment is not sent to
 * the server, so it cannot land in an access log, and browsers do not put it in the `Referer`
 * header of the requests the page then makes. A `?invite=` link leaks a working credential to
 * every log and analytics endpoint the page touches, and invites here are bearer tokens: the
 * server only ever sees `sha256(secret)`.
 *
 * It is then stripped from the address bar immediately, because the URL that survives is the
 * one that gets screenshotted, restored by "reopen last tabs", and synced to another device.
 *
 * Four states, all of them ordinary, none of them an error screen:
 *
 *  - **no secret at all** — someone typed `/join`, or the link lost its fragment on the way
 *    through a chat app. They get a field to paste the code into rather than a dead end.
 *  - **signed out** — they have to sign in first, and the secret has to survive that round
 *    trip. It is held in `sessionStorage` for exactly that reason (see below).
 *  - **invalid or expired** — `redeem_invite` answers with one generic failure for every
 *    cause, on purpose, so this screen cannot say which. It says what to do instead.
 *  - **already redeemed by this account** — idempotent on the server and here: the answer is
 *    "you are already in this gym", not an error.
 */

/**
 * Accepts `#invite=<secret>` and a bare `#<secret>`. Pure — no side effects — so React's
 * double-invoked render in StrictMode reads the same value twice instead of the second read
 * finding a fragment the first one already erased.
 */
function readInviteSecretFromHash(): string | null {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw) return null
  const named = new URLSearchParams(raw).get('invite')
  const secret = named ?? (raw.includes('=') ? null : decodeURIComponent(raw))
  const trimmed = secret?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function stripFragment(): void {
  try {
    const { pathname, search } = window.location
    // Preserve whatever state is already on the entry. React Router keeps its own
    // `{usr, key, idx}` bookkeeping there, and passing null erases it — after which
    // its history has no index and back/forward stop behaving. We are here to remove
    // the fragment, not the router's memory of how the user arrived.
    window.history.replaceState(window.history.state, '', `${pathname}${search}`)
  } catch {
    // Some embedded webviews refuse replaceState. The invite still works; the URL is just
    // uglier and the secret stays visible, which is why this is a fragment and not a query.
  }
}

/**
 * Where the secret waits while the visitor signs in.
 *
 * `sessionStorage`, not `localStorage`: it is scoped to this tab and dies with it, so a gym
 * phone passed to the next coach is not still carrying a working invite. It is needed at all
 * because the fragment is stripped on arrival and the trip through `/login` — and the
 * `no-membership` redirect that follows it — cannot carry a fragment.
 *
 * Both accessors throw outright in private mode and under a "block all cookies" policy, so
 * both are guarded: losing the stash costs the visitor a second tap on the original link,
 * while an unguarded read would white-screen the only route they have into the app.
 */
const STASH_KEY = 'trainhub.invite'

function readStash(): string | null {
  try {
    const value = window.sessionStorage.getItem(STASH_KEY)
    return value && value.trim() !== '' ? value : null
  } catch {
    return null
  }
}

function writeStash(secret: string | null): void {
  try {
    if (secret === null) window.sessionStorage.removeItem(STASH_KEY)
    else window.sessionStorage.setItem(STASH_KEY, secret)
  } catch {
    // Then the code lives only in this component's state, and a reload asks for the link again.
  }
}

type Phase = 'idle' | 'joined' | 'already' | 'invalid'

const cardStack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }

const titleStyle: CSSProperties = { fontSize: 'var(--th-text-2xl)', margin: 0 }

const bodyText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-ink)',
  lineHeight: 1.45,
}

const mutedText: CSSProperties = { ...bodyText, color: 'var(--th-muted)' }

const linkStyle: CSSProperties = {
  color: 'var(--th-accent)',
  fontWeight: 600,
  alignSelf: 'flex-start',
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
}

export function JoinScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { status, membership, reload } = useAuth()
  const redeem = useRedeemInvite()

  // The fragment on a first arrival; the stash after the round trip through the login screen.
  // Held in component state only — never in router state, which is serialised into the history
  // entry, the exact place the fragment was just taken out of.
  const [secret] = useState<string | null>(() => readInviteSecretFromHash() ?? readStash())
  const [typed, setTyped] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [fieldError, setFieldError] = useState<string | null>(null)

  // Layout effect, not a passive one: this runs before the browser paints, so the address bar
  // never renders a frame with a live credential in it.
  useLayoutEffect(() => {
    if (window.location.hash) stripFragment()
  }, [])

  // Stashed even when the visitor could redeem right now. The fragment is already gone by the
  // time anything renders, so without this a reload — or an accidental swipe back — loses a
  // link that may have arrived in a chat message somebody has since deleted.
  useEffect(() => {
    if (secret) writeStash(secret)
  }, [secret])

  const signedIn = status === 'ready' || status === 'no-membership'

  async function join(candidate: string): Promise<void> {
    const value = candidate.trim()
    if (value === '') {
      setFieldError(t('join.codeRequired'))
      return
    }
    setFieldError(null)
    // Captured before the call: on Supabase a repeat redemption is indistinguishable from a
    // first one by design, so "you were already in this gym" is something only the client can
    // still know — and only until the membership is re-resolved below.
    const previousGym = membership?.gymId ?? null

    let outcome: RedeemOutcome = { ok: false }
    try {
      outcome = await redeem.mutateAsync(value)
    } catch {
      // The mutation resolves rather than throwing for a refused invite; a throw here is the
      // network, and it is the same dead end for the person holding the phone.
      outcome = { ok: false }
    }

    if (!outcome.ok) {
      setPhase('invalid')
      // Kept, not discarded: an expired code is worth nothing, but a code that failed because
      // the phone was in a lift is worth another tap on "Join".
      return
    }

    writeStash(null)
    setPhase(outcome.invite.alreadyMember || outcome.invite.gymId === previousGym ? 'already' : 'joined')
    // The membership every route guard reads has just changed. Re-resolving it here is what
    // makes "Open the app" work: `RequireAuth` would otherwise still be holding
    // `no-membership` and bounce them straight back to this screen.
    await reload()
  }

  const header = (
    <div>
      <h1 className="display" style={titleStyle}>
        {t('join.title')}
      </h1>
      <p style={{ ...mutedText, marginTop: 4 }}>{t('join.subtitle')}</p>
    </div>
  )

  if (phase === 'joined' || phase === 'already') {
    return (
      <Screen label={t('join.title')} header={header}>
        <Card>
          <div role="status" style={cardStack}>
            <strong style={{ fontWeight: 600 }}>
              {phase === 'joined' ? t('join.joined') : t('join.already')}
            </strong>
            <span style={mutedText}>{t('join.joinedBody')}</span>
          </div>
        </Card>
        <Button
          variant="primary"
          block
          icon="sparkle"
          onClick={() => navigate('/athletes', { replace: true })}
        >
          {t('auth.demoEnter')}
        </Button>
      </Screen>
    )
  }

  if (status === 'loading') {
    return (
      <Screen label={t('join.title')} header={header}>
        <Spinner label={t('auth.checkingSession')} />
      </Screen>
    )
  }

  return (
    <Screen label={t('join.title')} header={header}>
      <Card>
        {/* The secret that arrived in the link is never rendered — a screenshot of this screen
            must not be a working invite. Only whether one arrived. */}
        <div role="status" style={cardStack}>
          <strong style={{ fontWeight: 600 }}>
            {secret ? t('join.linkReceived') : t('join.noSecret')}
          </strong>
          {secret ? <span style={mutedText}>{t('join.linkStripped')}</span> : null}
          {secret && !signedIn ? <span style={mutedText}>{t('join.held')}</span> : null}
          {!signedIn ? <span style={mutedText}>{t('join.signInFirst')}</span> : null}
        </div>
      </Card>

      {phase === 'invalid' ? (
        <Card tone="flat">
          <div role="status" style={cardStack}>
            <strong style={{ fontWeight: 600, color: 'var(--th-danger)' }}>
              {t('join.invalid')}
            </strong>
            {/* One generic failure covers a wrong, expired, revoked, spent and mis-addressed
                code. The screen cannot say which, so it says what to do about all five. */}
            <span style={mutedText}>{t('join.invalidHint')}</span>
          </div>
        </Card>
      ) : null}

      {!signedIn ? (
        <Link to="/login" style={linkStyle}>
          {t('auth.signIn')}
        </Link>
      ) : secret ? (
        <Button
          variant="primary"
          block
          icon="check"
          loading={redeem.isPending}
          disabled={redeem.isPending}
          onClick={() => void join(secret)}
        >
          {t('join.submit')}
        </Button>
      ) : (
        <>
          {/* The manual path, for a link that opened in another browser or arrived as text.
              This code is on screen because the person holding the phone is typing it, which
              is not the same as the app painting a credential it was handed. */}
          <Field label={t('join.codeLabel')} hint={t('join.codeHint')} error={fieldError ?? undefined}>
            <Input
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value)
                if (fieldError) setFieldError(null)
                if (phase === 'invalid') setPhase('idle')
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
            onClick={() => void join(typed)}
          >
            {t('join.submit')}
          </Button>
        </>
      )}
    </Screen>
  )
}
