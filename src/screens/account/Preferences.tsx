import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { currentLocale, LOCALES, setLocale } from '@/i18n'
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider'
import { Card, Segmented } from '@/ui'

/** Theme and language: the two settings every person has, whichever panel they are on. */

const THEME_OPTIONS: readonly ThemePreference[] = ['system', 'daylight', 'slate']

const sectionTitle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  fontWeight: 600,
  color: 'var(--th-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={sectionTitle}>{title}</h2>
      {children}
    </section>
  )
}

export function Preferences() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const locale = currentLocale()

  return (
    <>
      <SettingsSection title={t('settings.appearance')}>
        <Card>
          <Segmented
            label={t('settings.theme')}
            value={theme}
            options={THEME_OPTIONS.map((value) => ({
              value,
              label:
                value === 'system'
                  ? t('settings.themeSystem')
                  : value === 'daylight'
                    ? t('settings.themeDaylight')
                    : t('settings.themeSlate'),
            }))}
            onChange={setTheme}
          />
        </Card>
      </SettingsSection>

      <SettingsSection title={t('settings.language')}>
        <Card>
          {/* ΕΛ, not GR: GR is a country code, and the language is what is being chosen. */}
          <Segmented
            label={t('settings.language')}
            value={locale}
            options={LOCALES.map((value) => ({
              value,
              label: value === 'el' ? t('language.elShort') : t('language.enShort'),
            }))}
            onChange={(next) => void setLocale(next)}
          />
        </Card>
      </SettingsSection>
    </>
  )
}
