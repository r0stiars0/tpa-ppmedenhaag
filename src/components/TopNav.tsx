import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LanguageToggle } from './LanguageToggle'
import { NotificationBell } from '../features/notifications/NotificationBell'
import { useAuth } from '../context/AuthContext'

export function TopNav() {
  const { t } = useTranslation()
  const { signOut } = useAuth()

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between bg-ppme-primary px-4 text-white shadow-sm">
      <Link to="/" className="flex items-center gap-2 font-bold">
        {/* Reversed (pure white) wordmark — the bar is brand blue, so the
            full-colour logo used to need a white pill behind it to stay
            legible. With a real white variant the pill is gone and the
            mark sits directly on the blue. */}
        <img src="/logo-white.png" alt="PPME Den Haag" className="h-7 w-auto" />
        <span className="hidden sm:inline">{t('app.name')}</span>
      </Link>

      <div className="flex items-center gap-3">
        {/* Shown for every role: since ADR-014 admin reads and edits
            year-end reports like any other operational data. */}
        <Link
          to="/reports"
          className="hidden min-h-11 items-center rounded-md px-2 text-sm font-medium text-white/90 hover:text-white sm:flex"
        >
          {t('nav.laporan')}
        </Link>
        {/* Renders nothing for tutor/admin — see NotificationBell. */}
        <NotificationBell />
        <LanguageToggle />
        <button
          type="button"
          onClick={() => void signOut()}
          className="min-h-11 rounded-md px-2 text-sm font-medium text-white/80 hover:text-white"
        >
          {t('auth.signOut')}
        </button>
      </div>
    </header>
  )
}
