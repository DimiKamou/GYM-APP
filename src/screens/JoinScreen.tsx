import { useLayoutEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Screen } from '@/ui/Screen'
import { Placeholder } from '@/ui/Placeholder'

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
 * The redemption call itself (`redeem_invite`) is M3. This stub proves the transport.
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

export function JoinScreen() {
  const { t } = useTranslation()
  // Held in component state only. It is never put in router state, which is serialised into
  // the history entry — the exact place we just took it out of.
  const [secret] = useState<string | null>(readInviteSecretFromHash)

  // Layout effect, not a passive one: this runs before the browser paints, so the address bar
  // never renders a frame with a live credential in it.
  useLayoutEffect(() => {
    if (window.location.hash) stripFragment()
  }, [])

  return (
    <Screen label={t('join.title')}>
      <Placeholder
        title={t('join.title')}
        milestone="M3"
        description={t('placeholder.screens.join')}
      />

      <div
        role="status"
        style={{
          background: 'var(--th-surface)',
          border: '1px solid var(--th-line)',
          borderRadius: 'var(--th-r-lg)',
          padding: 'var(--th-pad)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {/* The secret itself is never rendered — a screenshot of this screen must not be a
            working invite. Only whether one arrived. */}
        <strong style={{ fontWeight: 600 }}>
          {secret ? t('join.linkReceived') : t('join.noSecret')}
        </strong>
        {secret ? (
          <span style={{ color: 'var(--th-muted)', fontSize: 'var(--th-text-sm)' }}>
            {t('join.linkStripped')}
          </span>
        ) : null}
        <span style={{ color: 'var(--th-muted)', fontSize: 'var(--th-text-sm)' }}>
          {t('join.signInFirst')}
        </span>
      </div>

      <Link
        to="/login"
        style={{
          color: 'var(--th-accent)',
          fontWeight: 600,
          alignSelf: 'flex-start',
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {t('auth.signIn')}
      </Link>
    </Screen>
  )
}
