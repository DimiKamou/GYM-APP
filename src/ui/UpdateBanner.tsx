import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { useUpdateReady } from '@/pwa/serviceWorker'
import { Button } from '@/ui/Button'
import { useOutboxPending } from '@/ui/SyncStatus'

/**
 * "A new version is ready", with the button that applies it — and the button waits while this
 * phone still holds unsent writes. The reload itself is safe for them (the outbox is on disk),
 * but a coach watching a set they typed show "waiting" across a reload types it again.
 */

const bar: CSSProperties = {
  order: -1,
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px var(--th-screen-pad)',
  paddingTop: 'calc(8px + env(safe-area-inset-top, 0px))',
  background: 'var(--th-accent-soft)',
  borderBottom: '1px solid var(--th-line)',
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-ink)',
}

export function UpdateBanner() {
  const { t } = useTranslation()
  const apply = useUpdateReady()
  const pending = useOutboxPending()
  if (!apply) return null
  const waiting = pending > 0
  return (
    <div role="status" style={bar}>
      <span style={{ flex: '1 1 auto', lineHeight: 1.4 }}>{waiting ? t('update.waiting') : t('update.ready')}</span>
      <Button variant="primary" size="sm" disabled={waiting} onClick={apply}>
        {t('update.apply')}
      </Button>
    </div>
  )
}
