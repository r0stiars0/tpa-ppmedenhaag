import { Outlet } from 'react-router-dom'
import { TopNav } from '../components/TopNav'
import { DesktopTabs } from '../components/DesktopTabs'
import { BottomTabNav } from '../components/BottomTabNav'
import { ScopeSwitch } from '../components/ScopeSwitch'
import { ViewScopeProvider } from '../context/ViewScopeContext'

/**
 * `ViewScopeProvider` wraps the chrome as well as the outlet, because
 * the scope switch renders inside `DesktopTabs` at `sm` and above
 * (TAD ADR-025). One provider, so the tab row and the page can never
 * disagree about which scope is selected.
 *
 * The mobile placement below is the same component with the same two
 * gates — it renders nothing at all unless the person holds two scopes
 * *and* is on one of the six two-shaped screens, so for every account
 * that has one relationship this file adds no markup and no vertical
 * space.
 */
export function AppLayout() {
  return (
    <ViewScopeProvider>
      <div className="min-h-screen bg-ppme-bg-alt">
        <TopNav />
        <DesktopTabs />
        <ScopeSwitch className="mx-4 mt-4 sm:hidden" />
        <main className="mx-auto max-w-2xl px-4 py-6 pb-24 sm:pb-6">
          <Outlet />
        </main>
        <BottomTabNav />
      </div>
    </ViewScopeProvider>
  )
}
