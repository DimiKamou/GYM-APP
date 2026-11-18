import { useEffect, useState, type CSSProperties } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import { pendingInviteRoute } from '@/auth/inviteStash'
import { Card, Screen, Spinner } from '@/ui'

/**
 * Where Google and Microsoft send the athlete back: `/auth/callback?code=…`.
 *
 * The code is single-use and is exchanged here, once, then taken out of the address bar — the
 * URL that survives is the one that gets shared, restored, and synced. It is not a secret on
 * its own (the PKCE verifier never left this browser), but a half-used code in a bookmark is
 * a sign-in that fails forever with no clue why.
 *
 * Nothing routes until the identity has resolved. "Signed out" is also the state BEFORE the
 * exchange finishes, so sending that to `/login` would bounce a successful sign-in back to
 * the form it just came from.
 */

const mutedText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  lineHeight: 1.45,
}

const linkStyle: CSSProperties = {
  color: 'var(--th-accent)',
  fontWeight: 600,
  alignSelf: 'flex-start',
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
}

/** Read once, before the effect strips it, so StrictMode's second render sees the same thing. */
function readCallback(): { code: string | null; failure: string | null } {
  if (typeof window === 'undefined') return { code: null, failure: null }
  const params = new URLSearchParams(window.location.search)
  return {
    code: params.get('code'),
    failure: params.get('error_description') ?? params.get('error'),
  }
}

export function AuthCallbackScreen() {
  const { t } = useTranslation()
  const { status, completeOAuth } = useAuth()
  const [{ code, failure }] = useState(readCallback)
  const [failed, setFailed] = useState<boolean>(() => failure !== null || code === null)

  useEffect(() => {
    try {
      window.history.replaceState(window.history.state, '', window.location.pathname)
    } catch {
      // A webview that refuses replaceState keeps the code visible; it is already spent.
    }
    if (!code || failure) return
    completeOAuth(code).catch(() => setFailed(true))
  }, [code, failure, completeOAuth])

  if (!failed) {
    if (status === 'athlete') return <Navigate to={pendingInviteRoute() ?? '/me'} replace />
    if (status === 'ready') return <Navigate to={pendingInviteRoute() ?? '/athletes'} replace />
    if (status === 'no-membership') return <Navigate to={pendingInviteRoute() ?? '/welcome'} replace />
  }

  if (failed || status === 'error') {
    return (
      <Screen label={t('authCallback.failed')}>
        <Card>
          <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <strong style={{ fontWeight: 600, color: 'var(--th-danger)' }}>{t('authCallback.failed')}</strong>
            <span style={mutedText}>{t('authCallback.failedBody')}</span>
          </div>
        </Card>
        <Link to="/login" replace style={linkStyle}>
          {t('authCallback.back')}
        </Link>
      </Screen>
    )
  }

  return (
    <Screen label={t('authCallback.working')}>
      <Spinner label={t('authCallback.working')} />
    </Screen>
  )
}
