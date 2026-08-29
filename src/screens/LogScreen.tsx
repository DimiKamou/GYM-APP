import type { CSSProperties } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Screen } from '@/ui/Screen'
import { Placeholder } from '@/ui/Placeholder'
import { Icon } from '@/ui/Icon'

/**
 * The Workout Log — the core screen, and the one the whole product is timed against.
 *
 * A routed stub. It is replaced wholesale in M2; nothing here anticipates that shape, because
 * the M2 gate is a real workout logged with a stopwatch and no set over eight seconds, which
 * is a layout question that a placeholder cannot usefully guess at.
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

export function LogScreen() {
  const { t } = useTranslation()
  const { sessionId } = useParams<'sessionId'>()
  const navigate = useNavigate()
  const location = useLocation()

  // See AthleteDetailScreen: a cold-opened URL has no history entry to pop back to.
  const goBack = () =>
    location.key === 'default' ? navigate('/athletes', { replace: true }) : navigate(-1)

  return (
    <Screen
      label={t('log.title')}
      header={
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button type="button" onClick={goBack} aria-label={t('common.back')} style={backButton}>
            <Icon name="back" strokeWidth={1.8} />
          </button>
        </div>
      }
    >
      <Placeholder
        title={t('log.title')}
        milestone="M2"
        description={t('placeholder.screens.log')}
        params={[['sessionId', sessionId]]}
      />
    </Screen>
  )
}
