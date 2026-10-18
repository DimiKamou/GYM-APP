import type { CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import { Button, Card, Icon, Screen } from '@/ui'
import { AccountActions } from '@/screens/account/AccountActions'
import { Preferences, SettingsSection } from '@/screens/account/Preferences'

/**
 * The athlete's settings: how the app looks, which account this is, and the way out of it.
 * Nothing about the gym — an athlete changes nothing there.
 */

const backButton: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 44,
  height: 44,
  borderRadius: 'var(--th-r-sm)',
  background: 'var(--th-surface)',
  border: '1px solid var(--th-line)',
  color: 'var(--th-ink)',
  flex: '0 0 auto',
}

const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }

const row: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  fontSize: 'var(--th-text-sm)',
}

const mutedText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  lineHeight: 1.45,
}

export function AthleteAccountScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, athlete, isDemo, signOut, setDemoPersona } = useAuth()

  const goBack = () => (location.key === 'default' ? navigate('/me', { replace: true }) : navigate(-1))

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <button type="button" onClick={goBack} aria-label={t('common.back')} style={backButton}>
        <Icon name="back" strokeWidth={1.8} />
      </button>
      <h1 className="display" style={{ fontSize: 'var(--th-text-2xl)', margin: 0 }}>
        {t('portal.account')}
      </h1>
    </div>
  )

  return (
    <Screen label={t('portal.account')} header={header}>
      <Preferences />

      <SettingsSection title={t('auth.account')}>
        <Card>
          <div style={stack}>
            <div style={row}>
              <span style={{ color: 'var(--th-muted)' }}>{t('auth.signedInAs')}</span>
              <span style={{ overflowWrap: 'anywhere', textAlign: 'right' }}>{user?.email ?? '—'}</span>
            </div>
            <div style={row}>
              <span style={{ color: 'var(--th-muted)' }}>{t('portal.gym')}</span>
              <span>{athlete?.gymName ?? '—'}</span>
            </div>
            {isDemo ? (
              <>
                <p style={mutedText}>{t('portal.demoBackHint')}</p>
                <Button variant="secondary" icon="team" onClick={() => setDemoPersona('staff')}>
                  {t('portal.demoBack')}
                </Button>
              </>
            ) : (
              <Button variant="dangerQuiet" icon="offline" onClick={() => void signOut()}>
                {t('auth.signOut')}
              </Button>
            )}
          </div>
        </Card>
        <AccountActions />
      </SettingsSection>
    </Screen>
  )
}
