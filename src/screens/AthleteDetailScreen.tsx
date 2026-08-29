import type { CSSProperties } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Screen } from '@/ui/Screen'
import { Placeholder } from '@/ui/Placeholder'
import { Icon } from '@/ui/Icon'

/**
 * One athlete: the Briefing Card, the stats, the history.
 *
 * A full-screen push over the tabs, so it owns a back control. A routed stub — replaced
 * wholesale in M3.
 */

const backButton: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 42,
  height: 42,
  borderRadius: 'var(--th-r-sm)',
  background: 'var(--th-surface)',
  border: '1px solid var(--th-line)',
  color: 'var(--th-ink)',
  flex: '0 0 auto',
}

export function AthleteDetailScreen() {
  const { t } = useTranslation()
  const { athleteId } = useParams<'athleteId'>()
  const navigate = useNavigate()
  const location = useLocation()

  // `key === 'default'` is the router's first history entry: the trainer opened this URL cold
  // (a shared link, a home-screen shortcut), so there is nothing behind it to pop.
  const goBack = () =>
    location.key === 'default' ? navigate('/athletes', { replace: true }) : navigate(-1)

  return (
    <Screen
      label={t('athlete.briefing')}
      header={
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button type="button" onClick={goBack} aria-label={t('common.back')} style={backButton}>
            <Icon name="back" strokeWidth={1.8} />
          </button>
        </div>
      }
    >
      <Placeholder
        title={t('athlete.briefing')}
        milestone="M3"
        description={t('placeholder.screens.athlete')}
        params={[['athleteId', athleteId]]}
      />
    </Screen>
  )
}
