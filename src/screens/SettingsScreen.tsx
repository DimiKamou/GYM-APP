import { useTranslation } from 'react-i18next'

import { Screen } from '@/ui/Screen'
import { Placeholder } from '@/ui/Placeholder'

/**
 * Gym, appearance, language, export, account.
 *
 * A routed stub. It is replaced wholesale in M6 — do not grow it into half a screen here.
 */
export function SettingsScreen() {
  const { t } = useTranslation()
  const title = t('settings.title')

  return (
    <Screen label={title}>
      <Placeholder title={title} milestone="M6" description={t('placeholder.screens.settings')} />
    </Screen>
  )
}
