import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ROLE_I18N_KEY } from '../../lib/roleLabels'
import type { AdminClass, AdminStudent, DirectoryUser } from './api'

export interface StudentFormValue {
  full_name: string
  date_of_birth: string
  /** The student's ACTIVE groups — any number (PRD Feature 8 FR-002). */
  class_ids: string[]
  user_id: string | null
  /** The wanted guardian set — at least one, no duplicates (ADR-040). */
  guardians: { user_id: string; relation: string | null }[]
}

interface StudentFormProps {
  initial?: AdminStudent
  classes: AdminClass[]
  /** Accounts an admin may name as a guardian (ADR-028 — parents, tutors, admins). */
  parents: DirectoryUser[]
  unlinkedAccounts: DirectoryUser[]
  saving: boolean
  onSave: (data: StudentFormValue) => void
  onCancel?: () => void
}

const NONE = ''

interface GuardianRow {
  user_id: string
  relation: string
}

function initialGuardians(initial?: AdminStudent): GuardianRow[] {
  if (initial && initial.guardians.length > 0) {
    return initial.guardians.map((g) => ({ user_id: g.user_id, relation: g.relation ?? '' }))
  }
  return [{ user_id: NONE, relation: '' }]
}

export function StudentForm({
  initial,
  classes,
  parents,
  unlinkedAccounts,
  saving,
  onSave,
  onCancel,
}: StudentFormProps) {
  const { t } = useTranslation()
  const [fullName, setFullName] = useState(initial?.full_name ?? '')
  const [dob, setDob] = useState(initial?.date_of_birth ?? '')
  const [classIds, setClassIds] = useState<string[]>(
    () => initial?.groups.filter((g) => !g.archived).map((g) => g.id) ?? [],
  )
  const activeClasses = classes.filter((c) => c.archived_at === null)
  const archivedGroups = initial?.groups.filter((g) => g.archived) ?? []

  function toggleClass(id: string) {
    setClassIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }
  const [userId, setUserId] = useState(initial?.user_id ?? NONE)
  const [guardians, setGuardians] = useState<GuardianRow[]>(() => initialGuardians(initial))

  const chosen = guardians.map((g) => g.user_id).filter(Boolean)
  const hasDuplicate = new Set(chosen).size !== chosen.length
  const allChosen = guardians.every((g) => g.user_id)
  const canSave = Boolean(fullName.trim()) && Boolean(dob) && allChosen && !hasDuplicate

  function setRow(index: number, patch: Partial<GuardianRow>) {
    setGuardians((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  function addRow() {
    setGuardians((rows) => [...rows, { user_id: NONE, relation: '' }])
  }
  function removeRow(index: number) {
    setGuardians((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows))
  }

  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-ppme-text/70">
        {t('admin.fullName')}
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
        />
      </label>

      <label className="block text-xs font-medium text-ppme-text/70">
        {t('admin.studentDob')}
        <input
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
        />
      </label>

      <div className="space-y-2">
        <span className="block text-xs font-medium text-ppme-text/70">
          {t('admin.studentGuardians')}
        </span>
        {/*
          A child has one or more guardians, all equal (ADR-040). The
          role beside each name is shown, not used to filter — the list
          already holds tutors and admins as well as parents (ADR-028).
        */}
        {guardians.map((row, index) => (
          <div key={index} className="flex items-start gap-2">
            <div className="flex-1 space-y-1">
              <select
                value={row.user_id}
                onChange={(e) => setRow(index, { user_id: e.target.value })}
                className="min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
              >
                <option value={NONE} disabled>
                  {parents.length === 0 ? t('admin.noParents') : '—'}
                </option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.full_name} · ${t(ROLE_I18N_KEY[p.role])}`}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={row.relation}
                onChange={(e) => setRow(index, { relation: e.target.value })}
                placeholder={t('admin.guardianRelationPlaceholder')}
                className="min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
              />
            </div>
            <button
              type="button"
              onClick={() => removeRow(index)}
              disabled={guardians.length === 1}
              aria-label={t('admin.removeGuardian')}
              className="min-h-11 rounded-lg border border-black/10 px-3 font-semibold text-ppme-text disabled:opacity-40"
            >
              −
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          className="min-h-11 rounded-lg border border-dashed border-black/20 px-3 text-sm font-medium text-ppme-text/80"
        >
          {t('admin.addGuardian')}
        </button>
        {hasDuplicate && (
          <p className="text-xs text-red-600">{t('admin.duplicateGuardian')}</p>
        )}
      </div>

      {/*
        Any number of groups, of either kind (PRD Feature 8 FR-002): a
        child is typically in a Yanbu'a/Quran group and an Aqidah group.
        Only active groups are offered; an archived group the child was
        in is history, shown below and kept as it is on save.
      */}
      <fieldset>
        <legend className="text-xs font-medium text-ppme-text/70">{t('admin.studentGroups')}</legend>
        {activeClasses.length === 0 ? (
          <p className="mt-1 text-xs text-ppme-text/50">{t('admin.noClasses')}</p>
        ) : (
          <div className="mt-1 space-y-1">
            {activeClasses.map((c) => (
              <label key={c.id} className="flex min-h-11 items-center gap-2 text-sm text-ppme-text">
                <input
                  type="checkbox"
                  checked={classIds.includes(c.id)}
                  onChange={() => toggleClass(c.id)}
                  className="h-4 w-4"
                />
                <span>
                  {c.name}
                  {!c.tracks_progress && (
                    <span className="ml-2 rounded-full bg-ppme-text/10 px-2 py-0.5 text-xs text-ppme-text/70">
                      {t('admin.noProgressTracking')}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
        {archivedGroups.length > 0 && (
          <p className="mt-1 text-xs text-ppme-text/50">
            {t('admin.archivedGroupsOfStudent', { groups: archivedGroups.map((g) => g.name).join(', ') })}
          </p>
        )}
      </fieldset>

      {unlinkedAccounts.length > 0 && (
        <label className="block text-xs font-medium text-ppme-text/70">
          {t('admin.linkSelfLogin')}
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
          >
            <option value={NONE}>{t('admin.linkSelfLoginNone')}</option>
            {unlinkedAccounts.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.email})
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving || !canSave}
          onClick={() =>
            onSave({
              full_name: fullName.trim(),
              date_of_birth: dob,
              class_ids: classIds,
              user_id: userId || null,
              guardians: guardians.map((g) => ({
                user_id: g.user_id,
                relation: g.relation.trim() || null,
              })),
            })
          }
          className="min-h-11 flex-1 rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
        >
          {saving ? t('common.loading') : t('common.save')}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-black/10 px-4 font-semibold text-ppme-text"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    </div>
  )
}
