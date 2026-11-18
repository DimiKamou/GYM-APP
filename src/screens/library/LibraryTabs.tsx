import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Icon } from '@/ui'

/**
 * Ασκήσεις | Προγράμματα — two screens of one library, so two tabs over their two routes.
 * Programmes are written from the catalogue's exercises, which is why they live here. Links,
 * not in-screen tabs: each keeps its own address, and the switch is a replace, so back still
 * leaves the library rather than flipping between its halves.
 */
export function LibraryTabs() {
  const { t } = useTranslation()
  const tabs = [
    { to: '/library', label: t('nav.library'), icon: 'library' as const },
    { to: '/programs', label: t('programs.title'), icon: 'note' as const },
  ]
  return (
    <div className="th-tabs">
      <nav aria-label={t('library.sections')} className="th-tabs__strip">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} replace end className="th-tabs__tab th-tabs__link">
            {({ isActive }) => (
              <>
                <Icon name={tab.icon} size={17} strokeWidth={isActive ? 2.2 : 1.7} />
                <span>{tab.label}</span>
                {isActive ? <span aria-hidden="true" className="th-tabs__underline" /> : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
