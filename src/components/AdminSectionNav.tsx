import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ADMIN_SECTION_TABS } from './tabs'

/**
 * Secondary nav *inside* the admin enrollment section, rendered at the
 * top of each `/admin/*` screen.
 *
 * Before ADR-014 these three were top-level tabs that replaced the
 * operational ones for admin. Now that admin keeps the five operational
 * tabs like every other role, they need a home that doesn't compete for
 * a bottom-nav slot — so they live one level down, behind the single
 * "Kelola" entry point, and this strip is how you move between them once
 * you're there.
 *
 * Scrolls horizontally rather than wrapping: three short labels fit on
 * any phone today, but a fourth enrollment screen shouldn't reflow the
 * page header to two lines.
 */
export function AdminSectionNav() {
  const { t } = useTranslation()

  return (
    <nav
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
      aria-label={t('nav.kelola')}
    >
      {ADMIN_SECTION_TABS.map(({ to, key }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-ppme-primary text-white'
                : 'bg-white text-ppme-text/70 shadow-sm hover:bg-ppme-bg-alt'
            }`
          }
        >
          {t(key)}
        </NavLink>
      ))}
    </nav>
  )
}
