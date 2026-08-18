import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useViewScope } from '../context/ViewScopeContext'
import { capabilityLabelKeys } from '../lib/viewScope'
import { NAV_TABS } from '../components/tabs'
import { WeeklySummary } from '../features/dashboard/WeeklySummary'

const TILE_CLASS =
  'min-h-11 rounded-lg bg-white p-4 text-center font-medium text-ppme-text shadow-sm transition-colors hover:bg-ppme-bg-alt'

/**
 * Every role gets the same operational tiles (the five feature tabs plus
 * Rapor) — including admin, which since ADR-014 is a super admin with
 * full read/write access to all of them rather than an enrollment-only
 * role fenced out of them.
 *
 * Admin additionally gets a "Kelola" tile: the single entry point into
 * the enrollment screens, which are still admin-only (`RequireAdmin`)
 * and no longer have top-level tabs of their own. That tile stays keyed
 * on `profile.role`: admin is a granted position rather than a
 * relationship (ADR-019(b)), and `RequireAdmin` guards the routes it
 * points at with the same check.
 *
 * The line under the person's name is the one thing here ADR-025
 * changes. It used to render a single label out of `users.role`, which
 * was the most visible place the app still asserted that a person is
 * one thing: it told Bapak Hasan he is "Orang Tua" while he teaches two
 * classes, and Aisyah she is "Santri" while she assists two. It now
 * lists the relationships actually held — and for the accounts that
 * hold one, or none yet, `capabilityLabelKeys` falls back to exactly
 * the label that was there before.
 */
export function Dashboard() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const { capabilities } = useViewScope()
  const isAdmin = profile?.role === 'admin'
  const labelKeys = capabilityLabelKeys(capabilities, profile?.role ?? null)

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-ppme-primary">
          {profile?.full_name ?? profile?.email}
        </h1>
        {labelKeys.length > 0 && (
          <p className="mt-1 text-sm text-ppme-text/70">
            {labelKeys.map((key) => t(key)).join(' · ')}
          </p>
        )}
      </div>

      {/* Where the Friday digest lands (ADR-016): the notification can
          only say a summary is ready, so the summary lives here. Renders
          nothing for a tutor or admin, and nothing in a quiet week. */}
      <WeeklySummary />

      <div className="grid grid-cols-2 gap-3">
        {NAV_TABS.map(({ to, key }) => (
          <Link key={to} to={to} className={TILE_CLASS}>
            {t(key)}
          </Link>
        ))}
        <Link to="/reports" className={TILE_CLASS}>
          {t('nav.laporan')}
        </Link>
      </div>

      {/* Every role, not only recipients: the settings screen also
          explains what a notification can contain, and a tutor or admin
          should be able to read that too (TAD ADR-015). */}
      <Link
        to="/settings/notifications"
        className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-white p-4 shadow-sm transition-colors hover:bg-ppme-bg-alt"
      >
        <span className="font-medium text-ppme-text">{t('common.notifications')}</span>
        <span aria-hidden className="text-ppme-primary">
          →
        </span>
      </Link>

      {isAdmin && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-ppme-text/70">{t('nav.kelola')}</h2>
          <Link
            to="/admin"
            className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-white p-4 shadow-sm transition-colors hover:bg-ppme-bg-alt"
          >
            <span>
              <span className="block font-medium text-ppme-text">{t('nav.kelola')}</span>
              <span className="block text-xs text-ppme-text/60">{t('admin.hubSubtitle')}</span>
            </span>
            <span aria-hidden className="text-ppme-primary">
              →
            </span>
          </Link>
        </div>
      )}
    </div>
  )
}
