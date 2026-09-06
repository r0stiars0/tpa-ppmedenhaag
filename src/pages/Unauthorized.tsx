import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { getErrorMessage } from '../lib/errors'
import {
  fetchMyRegistrationRequest,
  initialRegistrationName,
  isAlreadyRegisteredError,
  submitRegistrationRequest,
} from '../features/auth/api'

const FULL_NAME_MAX = 120
const DESCRIPTION_MAX = 2000

/**
 * E2E-08 / E2E-18: an authenticated Google account with no `public.users`
 * row. Beyond the "contact admin" message it now carries a form
 * (ADR-038) letting the user submit their name + free-text context for
 * the admin to see when approving. A submission does not grant access —
 * the screen stays until an admin creates the profile row.
 */
export function Unauthorized() {
  const { t } = useTranslation()
  const { session, signOut } = useAuth()
  const userId = session?.user.id ?? null

  const [loading, setLoading] = useState(true)
  const [fullName, setFullName] = useState('')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    let active = true
    fetchMyRegistrationRequest(userId)
      .then((existing) => {
        if (!active) return
        setFullName(initialRegistrationName(existing, session))
        setDescription(existing?.description ?? '')
        setSubmitted(existing != null)
      })
      .catch((err) => active && setError(getErrorMessage(err)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
    // `session` is only read for its immutable user metadata on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  async function handleSubmit() {
    if (!userId || !fullName.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await submitRegistrationRequest({ id: userId, full_name: fullName, description })
      setSubmitted(true)
    } catch (err) {
      if (isAlreadyRegisteredError(err)) {
        // An admin approved the account while this screen was open — the
        // app router will land on the real home once the profile loads.
        window.location.reload()
        return
      }
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ppme-bg-alt px-6 py-10 text-center">
      <h1 className="text-xl font-bold text-ppme-primary">{t('app.name')}</h1>
      <p className="max-w-sm text-ppme-text">
        {submitted ? t('auth.registrationSubmitted') : t('auth.unauthorized')}
      </p>
      {session?.user.email && (
        <p className="text-sm text-ppme-text/60">{session.user.email}</p>
      )}

      {!loading && userId && (
        <div className="w-full max-w-sm space-y-3 text-left">
          {!submitted && (
            <p className="text-sm text-ppme-text/70">{t('auth.registrationIntro')}</p>
          )}

          <label className="block text-xs font-medium text-ppme-text/70">
            {t('auth.registrationFullName')}
            <input
              type="text"
              value={fullName}
              maxLength={FULL_NAME_MAX}
              disabled={saving}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
            />
          </label>

          <label className="block text-xs font-medium text-ppme-text/70">
            {t('auth.registrationDescription')}
            <textarea
              value={description}
              maxLength={DESCRIPTION_MAX}
              disabled={saving}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-ppme-text"
            />
          </label>

          {error && (
            <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>
          )}

          <button
            type="button"
            disabled={saving || !fullName.trim()}
            onClick={() => void handleSubmit()}
            className="min-h-11 w-full rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
          >
            {saving ? t('common.loading') : t('auth.registrationSubmit')}
          </button>
        </div>
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
