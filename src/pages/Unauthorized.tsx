import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'

/** E2E-08: unregistered Google account signs in → "contact admin" screen, no data. */
export function Unauthorized() {
  const { t } = useTranslation()
  const { session, signOut } = useAuth()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ppme-bg-alt px-6 text-center">
      <h1 className="text-xl font-bold text-ppme-primary">{t('app.name')}</h1>
      <p className="max-w-sm text-ppme-text">{t('auth.unauthorized')}</p>
      {session?.user.email && (
        <p className="text-sm text-ppme-text/60">{session.user.email}</p>
      )}
      <button
        type="button"
        onClick={() => void signOut()}
        className="min-h-11 rounded-lg border border-ppme-primary px-6 py-2 font-semibold text-ppme-primary transition-colors hover:bg-ppme-primary hover:text-white"
      >
        {t('auth.signOut')}
      </button>
    </div>
  )
}
