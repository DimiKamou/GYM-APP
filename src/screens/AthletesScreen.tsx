import { useTranslation } from 'react-i18next'

import { Screen } from '@/ui/Screen'
import { Placeholder } from '@/ui/Placeholder'

/**
 * The roster: search, last session per athlete, and the entry point to everything else.
 *
 * A routed stub. It is replaced wholesale in M3 — do not grow it into half a screen here.
 */
export function AthletesScreen() {
  const { t } = useTranslation()
  const title = t('athletes.title')

  return (
    <Screen label={title}>
      <Placeholder title={title} milestone="M3" description={t('placeholder.screens.athletes')} />
    </Screen>
  )
}
