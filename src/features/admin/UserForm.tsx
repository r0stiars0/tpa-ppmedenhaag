import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Database } from '../../lib/database.types'
import { ROLE_I18N_KEY } from '../../lib/roleLabels'
import type { DirectoryUser } from './api'

type UserRole = Database['public']['Enums']['user_role']

const ROLE_ORDER: UserRole[] = ['admin', 'tutor', 'parent', 'student']

export interface UserFormValue {
  full_name: string
  role: UserRole
}

interface UserFormProps {
  initial: DirectoryUser
  /** The signed-in admin's own row: role is locked (ADR-042 hard block). */
  isSelf: boolean
  saving: boolean
  onSave: (value: UserFormValue) => void
  onCancel: () => void
}

export function UserForm({ initial, isSelf, saving, onSave, onCancel }: UserFormProps) {
  const { t } = useTranslation()
  const [fullName, setFullName] = useState(initial.full_name)
  const [role, setRole] = useState<UserRole>(initial.role)

  const canSave = fullName.trim().length > 0 && fullName.trim().length <= 120

  return (
    <div className="space-y-3">
      <p className="text-sm text-ppme-text/60">{initial.email}</p>

      <label className="block text-xs font-medium text-ppme-text/70">
        {t('admin.fullName')}
        <input
          type="text"
          value={fullName}
          maxLength={120}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
        />
      </label>

      <label className="block text-xs font-medium text-ppme-text/70">
        {t('admin.assignRole')}
        <select
          value={role}
          disabled={isSelf}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text disabled:opacity-60"
        >
          {ROLE_ORDER.map((r) => (
            <option key={r} value={r}>
              {t(ROLE_I18N_KEY[r])}
            </option>
          ))}
        </select>
      </label>
      {isSelf && <p className="text-xs text-ppme-text/60">{t('admin.userCannotEditOwnRole')}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving || !canSave}
          onClick={() => onSave({ full_name: fullName.trim(), role })}
          className="min-h-11 flex-1 rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
        >
          {saving ? t('common.loading') : t('common.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-lg border border-black/10 px-4 font-semibold text-ppme-text"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
