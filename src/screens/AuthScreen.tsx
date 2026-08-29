import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Screen } from '@/ui/Screen'
import { Placeholder } from '@/ui/Placeholder'
import { useAuth } from '@/auth/useAuth'

/**
 * Sign-in. Public route.
 *
 * A routed stub for the email-OTP form (M1). It does render one real thing: the `unconfigured`
 * status. Without it a developer with an empty `.env` gets a login form that fails forty
 * seconds later on a DNS error, with nothing on screen naming the cause.
 */
export function AuthScreen() {
  const { t } = useTranslation()
  const { status, missingEnv, error } = useAuth()

  return (
    <Screen label={t('auth.title')}>
      <Placeholder
        title={t('auth.title')}
        milestone="M1"
        description={t('placeholder.screens.auth')}
      />

      {status === 'unconfigured' || error ? (
        <div
          style={{
            background: 'var(--th-danger-soft)',
            border: '1px solid var(--th-line)',
            borderRadius: 'var(--th-r-lg)',
            padding: 'var(--th-pad)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
          role="status"
        >
          <strong style={{ color: 'var(--th-danger)', fontWeight: 600 }}>
            {status === 'unconfigured' ? t('auth.notConfiguredTitle') : t('errors.genericTitle')}
          </strong>
          <span style={{ color: 'var(--th-ink)', fontSize: 'var(--th-text-sm)' }}>
            {status === 'unconfigured'
              ? t('auth.notConfiguredBody', { vars: missingEnv.join(', ') })
              : t('errors.genericBody')}
          </span>
        </div>
      ) : null}

      <Link
        to="/join"
        style={{
          color: 'var(--th-accent)',
          fontWeight: 600,
          alignSelf: 'flex-start',
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {t('auth.haveInvite')}
      </Link>
    </Screen>
  )
}
