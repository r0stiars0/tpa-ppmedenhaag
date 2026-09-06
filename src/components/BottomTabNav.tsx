import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { bottomNavTabs } from './tabs'

/**
 * The mobile bottom nav (portrait phones — `sm:hidden`, so it is the
 * only nav below 640px; landscape and desktop keep `DesktopTabs` on
 * top).
 *
 * It carries the five prototype-validated operational tabs (ADR-014),
 * then Rapport for every role, then Beheer for admin — see
 * `bottomNavTabs`. Seven 44px targets do not fit across a 390px column,
 * so the bar **scrolls horizontally under the thumb** (`overflow-x-auto`,
 * the same pattern `AdminSectionNav` and now `DesktopTabs` use) rather
 * than clipping its tail: before this, "Rapport" and "Beheer" sat off
 * the right edge in portrait with no way to reach them.
 *
 * Each tab is `flex-1` with a fixed min width, so the six-tab case (a
 * non-admin) still stretches to fill a 390px bar with only a little
 * overflow, while the seven-tab admin case overflows enough to need a
 * swipe. The active tab is scrolled into view on navigation so a
 * deep-linked Rapport or Beheer is never hidden past the edge.
 *
 * ADR-025's scope switch is still **not** here: a scope is not a
 * destination — pressing it changes what the current screen is about
 * while leaving you on it. It renders above the content on mobile
 * (`AppLayout`) and in the `DesktopTabs` row on desktop.
 */
export function BottomTabNav() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const { pathname } = useLocation()
  const navRef = useRef<HTMLElement>(null)
  const tabs = bottomNavTabs(profile?.role)

  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    active?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [pathname])

  return (
    <nav
      ref={navRef}
      className="fixed inset-x-0 bottom-0 z-10 flex overflow-x-auto border-t border-black/5 bg-white pb-[env(safe-area-inset-bottom)] [scrollbar-width:none] sm:hidden [&::-webkit-scrollbar]:hidden"
      aria-label={t('app.name')}
    >
      {tabs.map(({ to, key }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex min-h-11 min-w-[4.5rem] flex-1 shrink-0 flex-col items-center justify-center gap-0.5 whitespace-nowrap px-1 py-2 text-xs font-medium ${
              isActive ? 'text-ppme-primary' : 'text-ppme-text/60'
            }`
          }
        >
          {t(key)}
        </NavLink>
      ))}
    </nav>
  )
}
