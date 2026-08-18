import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { DevAuthSwitcher } from '../dev/DevAuthSwitcher'

export function SignIn() {
  const { t } = useTranslation()
  const { signInWithGoogle } = useAuth()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-ppme-bg-alt px-6 text-center">
      <img src="/logo.png" alt="PPME Den Haag" className="h-16 w-auto" />
      <div>
        <h1 className="text-2xl font-bold text-ppme-primary">{t('app.name')}</h1>
        <p className="mt-1 text-ppme-text/70">{t('app.tagline')}</p>
      </div>
      <button
        type="button"
        onClick={() => void signInWithGoogle()}
        className="min-h-11 rounded-lg bg-ppme-primary px-6 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-ppme-primary-dark"
      >
        {t('auth.signIn')}
      </button>
      {import.meta.env.DEV && <DevAuthSwitcher />}
    </div>
  )
}
