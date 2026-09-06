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
 * `bottomNavTabs`. Even four or five generous targets do not fit across
 * a 390px column, so the bar **scrolls horizontally under the thumb**
 * (`overflow-x-auto`, the same pattern `AdminSectionNav` and now
 * `DesktopTabs` use) rather than clipping its tail: before this,
 * "Rapport" and "Beheer" sat off the right edge in portrait with no way
 * to reach them.
 *
 * The targets are deliberately large — `min-h-14` (56px, above the 44px
 * floor) and `min-w-[5.25rem]` with `text-sm` — so the bar is
 * comfortable for a large thumb; because it scrolls, making each tab
 * bigger costs reach on neither end. Each tab is also `flex-1`, so when
 * only a few are present they still stretch to fill the bar rather than
 * leaving dead space. The active tab is scrolled into view on
 * navigation so a deep-linked Rapport or Beheer is never hidden past the
 * edge.
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
            `flex min-h-14 min-w-[5.25rem] flex-1 shrink-0 flex-col items-center justify-center gap-1 whitespace-nowrap px-2 py-2.5 text-sm font-medium ${
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
