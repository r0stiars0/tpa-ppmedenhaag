import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { NAV_TABS } from './tabs'
import { ScopeSwitch } from './ScopeSwitch'

/**
 * Same five operational tabs as the mobile bottom nav, plus — for admin
 * only — a single "Kelola" entry into the enrollment section. Desktop
 * has the horizontal room the bottom nav doesn't, so this is where the
 * admin entry point can live as a tab rather than only as a dashboard
 * tile. `to="/admin"` (no `end`) so the tab stays highlighted across
 * every `/admin/*` sub-screen.
 *
 * The Kelola tab stays keyed on `profile.role` and is *not* moved to
 * `capabilities.isAdmin` by ADR-025. The two are the same expression —
 * `isAdmin` is the one capability that is still a role check, because
 * `fn_is_admin()` is one (ADR-019(b)) — and reading it here would make
 * the tab bar wait on two relationship queries to decide whether to
 * draw a tab that never depended on a relationship.
 *
 * The scope switch shares this row for the reason the admin tab does:
 * horizontal room. It is not a sixth tab and must never become one —
 * five 44px targets is what a mobile bottom nav fits (ADR-014,
 * `tabs.test.ts`), and a scope is not a destination. It renders nothing
 * unless the signed-in person holds more than one relationship and is
 * on one of the six screens a scope changes.
 *
 * The tabs sit in their own `overflow-x-auto` track so they scroll
 * rather than clip when the row runs out of room — six labels at the
 * larger text a device or a longer translation can impose will not fit
 * a landscape phone (`sm` starts at 640px), and without this the last
 * tab, "Beheer", simply disappeared with no way to reach it. Same
 * pattern `AdminSectionNav` already uses. The scope switch stays a
 * sibling of the track, `shrink-0`, so it is always visible on the
 * right no matter how far the tabs are scrolled.
 */
export function DesktopTabs() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const tabs = profile?.role === 'admin' ? [...NAV_TABS, { to: '/admin', key: 'nav.kelola' }] : NAV_TABS

  return (
    <nav
      className="hidden border-b border-black/5 bg-white px-4 sm:flex"
      aria-label={t('app.name')}
    >
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {tabs.map(({ to, key }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${
                isActive
                  ? 'border-ppme-primary text-ppme-primary'
                  : 'border-transparent text-ppme-text/60 hover:text-ppme-text'
              }`
            }
          >
            {t(key)}
          </NavLink>
        ))}
      </div>
      {/* `self-center` rather than stretching: the tabs keep their
          underline on the bottom border of the row, which they would
          lose if the row aligned everything to its centre. `shrink-0`
          keeps it off the scrollable track. */}
      <ScopeSwitch className="ml-2 shrink-0 self-center" />
    </nav>
  )
}
