import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminSectionNav } from '../../components/AdminSectionNav'
import type { Database } from '../../lib/database.types'
import { getErrorMessage } from '../../lib/errors'
import { fetchPendingRegistrations, inviteUser, registerUser, type PendingRegistration } from './api'

type UserRole = Database['public']['Enums']['user_role']

const ROLE_OPTIONS: { value: UserRole; labelKey: string }[] = [
  { value: 'parent', labelKey: 'roles.orangTua' },
  { value: 'tutor', labelKey: 'roles.ustadz' },
  { value: 'student', labelKey: 'roles.santri' },
  { value: 'admin', labelKey: 'roles.admin' },
]

export function RegistrationsPage() {
  const { t, i18n } = useTranslation()
  const [pending, setPending] = useState<PendingRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { full_name: string; role: UserRole }>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFullName, setInviteFullName] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('parent')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null)

  const dateFormatter = new Intl.DateTimeFormat(i18n.language === 'nl' ? 'nl-NL' : 'id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  function load() {
    setLoading(true)
    setError(null)
    fetchPendingRegistrations()
      .then(setPending)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function handleInvite() {
    if (!inviteEmail.trim() || !inviteFullName.trim()) return
    setInviting(true)
    setInviteError(null)
    setInvitedEmail(null)
    try {
      await inviteUser({ email: inviteEmail.trim(), full_name: inviteFullName.trim(), role: inviteRole })
      setInvitedEmail(inviteEmail.trim())
      setInviteEmail('')
      setInviteFullName('')
      setInviteRole('parent')
    } catch (err) {
      setInviteError(getErrorMessage(err))
    } finally {
      setInviting(false)
    }
  }

  function draftFor(userId: string) {
    return drafts[userId] ?? { full_name: '', role: 'parent' as UserRole }
  }

  async function handleRegister(user: PendingRegistration) {
    const draft = draftFor(user.id)
    if (!draft.full_name.trim()) return
    setSavingId(user.id)
    setError(null)
    try {
      await registerUser({ id: user.id, email: user.email, full_name: draft.full_name.trim(), role: draft.role })
      setPending((prev) => prev.filter((p) => p.id !== user.id))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <AdminSectionNav />
      <h1 className="text-lg font-bold text-ppme-primary">{t('admin.registrationsTitle')}</h1>

      <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-ppme-text">{t('admin.inviteSectionTitle')}</p>

        {invitedEmail && (
          <p className="rounded-lg bg-ppme-success/10 p-3 text-sm text-ppme-success">
            {t('admin.invited', { email: invitedEmail })}
          </p>
        )}
        {inviteError && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{inviteError}</p>}

        <label className="block text-xs font-medium text-ppme-text/70">
          {t('admin.inviteEmail')}
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
          />
        </label>

        <label className="block text-xs font-medium text-ppme-text/70">
          {t('admin.fullName')}
          <input
            type="text"
            value={inviteFullName}
            onChange={(e) => setInviteFullName(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
          />
        </label>

        <label className="block text-xs font-medium text-ppme-text/70">
          {t('admin.assignRole')}
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as UserRole)}
            className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={inviting || !inviteEmail.trim() || !inviteFullName.trim()}
          onClick={() => void handleInvite()}
          className="min-h-11 w-full rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
        >
          {inviting ? t('common.loading') : t('admin.inviteButton')}
        </button>
      </div>

      <h2 className="text-sm font-semibold text-ppme-text/70">{t('admin.pendingListTitle')}</h2>

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

      {loading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : pending.length === 0 ? (
        <p className="text-ppme-text/60">{t('admin.registrationsEmpty')}</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((user) => {
            const draft = draftFor(user.id)
            return (
              <li key={user.id} className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
                <div>
                  <p className="font-medium text-ppme-text">{user.email}</p>
                  <p className="text-xs text-ppme-text/60">
                    {t('admin.registeredSince', { date: dateFormatter.format(new Date(user.created_at)) })}
                  </p>
                </div>

                <label className="block text-xs font-medium text-ppme-text/70">
                  {t('admin.fullName')}
                  <input
                    type="text"
                    value={draft.full_name}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [user.id]: { ...draft, full_name: e.target.value } }))
                    }
                    className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
                  />
                </label>

                <label className="block text-xs font-medium text-ppme-text/70">
                  {t('admin.assignRole')}
                  <select
                    value={draft.role}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [user.id]: { ...draft, role: e.target.value as UserRole } }))
                    }
                    className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
                  >
                    {ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {t(opt.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  disabled={savingId === user.id || !draft.full_name.trim()}
                  onClick={() => void handleRegister(user)}
                  className="min-h-11 w-full rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
                >
                  {savingId === user.id ? t('common.loading') : t('admin.register')}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
