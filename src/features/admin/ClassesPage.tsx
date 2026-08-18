import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminSectionNav } from '../../components/AdminSectionNav'
import { getErrorMessage } from '../../lib/errors'
import { createClass, fetchAllClasses, fetchUsersForLink, updateClass, type AdminClass, type DirectoryUser } from './api'
import { TUTOR_LINK_ROLES } from '../../lib/enrolmentLinks'
import { ClassForm } from './ClassForm'

export function ClassesPage() {
  const { t } = useTranslation()
  const [classes, setClasses] = useState<AdminClass[]>([])
  const [tutors, setTutors] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  function load() {
    setLoading(true)
    setError(null)
    // Not just `role = 'tutor'`: an admin teaches (ADR-014) and a 16+
    // santri may assist the class they attend (ADR-020, RLS-35), which
    // until now no admin screen could set up (ADR-028).
    Promise.all([fetchAllClasses(), fetchUsersForLink(TUTOR_LINK_ROLES)])
      .then(([classData, tutorData]) => {
        setClasses(classData)
        setTutors(tutorData)
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function handleCreate(data: { name: string; schedule: string | null; tutor_ids: string[] }) {
    setSaving(true)
    setError(null)
    try {
      const created = await createClass(data)
      setClasses((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setCreating(false)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(id: string, data: { name: string; schedule: string | null; tutor_ids: string[] }) {
    setSaving(true)
    setError(null)
    try {
      const updated = await updateClass(id, data)
      setClasses((prev) => prev.map((c) => (c.id === id ? updated : c)))
      setEditingId(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  function tutorNames(tutorIds: string[]) {
    if (tutorIds.length === 0) return t('admin.noTutors')
    return tutorIds.map((id) => tutors.find((t) => t.id === id)?.full_name ?? '?').join(', ')
  }

  return (
    <div className="space-y-4">
      <AdminSectionNav />
      <h1 className="text-lg font-bold text-ppme-primary">{t('admin.classesTitle')}</h1>

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

      <div className="rounded-lg bg-white p-4 shadow-sm">
        {creating ? (
          <ClassForm tutors={tutors} saving={saving} onSave={handleCreate} onCancel={() => setCreating(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="min-h-11 w-full rounded-lg border-2 border-dashed border-ppme-primary/30 px-4 font-semibold text-ppme-primary hover:bg-ppme-bg-alt"
          >
            + {t('admin.newClass')}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : classes.length === 0 ? (
        <p className="text-ppme-text/60">{t('admin.noClasses')}</p>
      ) : (
        <ul className="space-y-2">
          {classes.map((cls) => (
            <li key={cls.id} className="rounded-lg bg-white p-4 shadow-sm">
              {editingId === cls.id ? (
                <ClassForm
                  initial={cls}
                  tutors={tutors}
                  saving={saving}
                  onSave={(data) => void handleUpdate(cls.id, data)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ppme-text">{cls.name}</p>
                    {cls.schedule && <p className="text-sm text-ppme-text/60">{cls.schedule}</p>}
                    <p className="mt-1 text-xs text-ppme-text/50">{tutorNames(cls.tutor_ids)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingId(cls.id)}
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
