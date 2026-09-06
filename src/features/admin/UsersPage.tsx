import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminSectionNav } from '../../components/AdminSectionNav'
import { useAuth } from '../../context/AuthContext'
import type { Database } from '../../lib/database.types'
import { getErrorMessage } from '../../lib/errors'
import { ROLE_I18N_KEY } from '../../lib/roleLabels'
import {
  fetchAllUsers,
  fetchUserRoleImpact,
  updateUser,
  type DirectoryUser,
} from './api'
import { UserForm, type UserFormValue } from './UserForm'

type UserRole = Database['public']['Enums']['user_role']

const ROLE_FILTERS: UserRole[] = ['admin', 'tutor', 'parent', 'student']

const ROLE_BADGE: Record<UserRole, string> = {
  admin: 'bg-ppme-primary/10 text-ppme-primary',
  tutor: 'bg-ppme-accent/15 text-ppme-primary',
  parent: 'bg-ppme-text/10 text-ppme-text/70',
  student: 'bg-ppme-success/10 text-ppme-success',
}

/**
 * `/admin/users` — the TPA head's directory of everyone with a profile,
 * with inline editing of display name and role (TAD ADR-042, PRD FR-009).
 * Admin-only (`RequireAdmin` on the route). Shape mirrors `StudentsPage`:
 * `AdminSectionNav`, a list of cards, one open inline editor at a time.
 *
 * Creating / inviting / removing accounts is not here — that stays on the
 * Registrations screen. This screen only edits accounts that already
 * exist. A role change goes through `fn_admin_update_user`, which refuses
 * the two hard cases (last admin, self) and, for a tutor being
 * downgraded, first shows the groups they will be unassigned from.
 */
export function UsersPage() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('')

  function load() {
    setLoading(true)
    setError(null)
    fetchAllUsers()
      .then(setUsers)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      const matchesQuery =
        !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      const matchesRole = roleFilter === '' || u.role === roleFilter
      return matchesQuery && matchesRole
    })
  }, [users, search, roleFilter])

  /**
   * Save flow (ADR-042): a name-only change writes straight through. A
   * role change first asks `fn_admin_user_role_impact` — a hard block
   * (`would_block`) surfaces as an error and keeps the editor open; any
   * consequences produce a `window.confirm` listing them before the write.
   */
  async function handleSave(user: DirectoryUser, value: UserFormValue) {
    setSaving(true)
    setError(null)
    try {
      if (value.role !== user.role) {
        const impact = await fetchUserRoleImpact(user.id, value.role)
        if (impact.wouldBlock) {
          setError(
            t(
              impact.wouldBlock === 'self'
                ? 'admin.userRoleBlockedSelf'
                : 'admin.userRoleBlockedLastAdmin',
            ),
          )
          return
        }
        const lines = [
          t('admin.userRoleChangeConfirmIntro', {
            name: user.full_name,
            role: t(ROLE_I18N_KEY[value.role]),
          }),
        ]
        if (impact.tutorGroups.length > 0) {
          lines.push(t('admin.userRoleImpactTutorGroups', { groups: impact.tutorGroups.join(', ') }))
        }
        if (impact.guardianChildren.length > 0) {
          lines.push(
            t('admin.userRoleImpactGuardian', { children: impact.guardianChildren.join(', ') }),
          )
        }
        if (impact.linkedStudent) {
          lines.push(t('admin.userRoleImpactLinkedStudent', { student: impact.linkedStudent }))
        }
        if (!window.confirm(lines.join('\n\n'))) return
      }
      await updateUser({ id: user.id, full_name: value.full_name, role: value.role })
      setEditingId(null)
      load()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <AdminSectionNav />
      <h1 className="text-lg font-bold text-ppme-primary">{t('admin.usersTitle')}</h1>

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.usersSearchPlaceholder')}
          className="min-h-11 flex-1 rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as UserRole | '')}
          className="min-h-11 rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
        >
          <option value="">{t('admin.allRoles')}</option>
          {ROLE_FILTERS.map((r) => (
            <option key={r} value={r}>
              {t(ROLE_I18N_KEY[r])}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <p className="text-ppme-text/60">
          {users.length === 0 ? t('common.empty') : t('admin.usersNoResults')}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((u) => (
            <li key={u.id} className="rounded-lg bg-white p-4 shadow-sm">
              {editingId === u.id ? (
                <UserForm
                  initial={u}
                  isSelf={u.id === profile?.id}
                  saving={saving}
                  onSave={(value) => void handleSave(u, value)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-ppme-text">{u.full_name}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_BADGE[u.role]}`}
                      >
                        {t(ROLE_I18N_KEY[u.role])}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-ppme-text/60">{u.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingId(u.id)}
                    className="min-h-11 shrink-0 rounded-md px-3 text-sm font-medium text-ppme-primary hover:bg-ppme-bg-alt"
                  >
                    {t('common.edit')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
