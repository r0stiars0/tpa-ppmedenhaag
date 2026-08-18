import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminSectionNav } from '../../components/AdminSectionNav'
import { getErrorMessage } from '../../lib/errors'
import { PARENT_LINK_ROLES, selfLoginAccountsToOffer } from '../../lib/enrolmentLinks'
import {
  createStudent,
  fetchAllClasses,
  fetchAllStudents,
  fetchUnlinkedStudentAccounts,
  fetchUsersForLink,
  updateStudent,
  type AdminClass,
  type AdminStudent,
  type DirectoryUser,
} from './api'
import { StudentForm } from './StudentForm'

export function StudentsPage() {
  const { t } = useTranslation()
  const [students, setStudents] = useState<AdminStudent[]>([])
  const [classes, setClasses] = useState<AdminClass[]>([])
  const [parents, setParents] = useState<DirectoryUser[]>([])
  const [unlinked, setUnlinked] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    setError(null)
    Promise.all([
      fetchAllStudents(),
      fetchAllClasses(),
      // Not just `role = 'parent'`: a tutor or an admin may be a
      // child's parent contact (ADR-024/ADR-028), and filtering them
      // out is what made every multi-relationship account in this
      // project something only SQL could create.
      fetchUsersForLink(PARENT_LINK_ROLES),
      fetchUnlinkedStudentAccounts(),
    ])
      .then(([studentData, classData, parentData, unlinkedData]) => {
        setStudents(studentData)
        setClasses(classData)
        setParents(parentData)
        setUnlinked(unlinkedData)
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function handleCreate(data: {
    full_name: string
    date_of_birth: string
    class_id: string | null
    parent_id: string
    user_id: string | null
  }) {
    setSaving(true)
    setError(null)
    try {
      await createStudent(data)
      setCreating(false)
      load()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(
    id: string,
    data: {
      full_name: string
      date_of_birth: string
      class_id: string | null
      parent_id: string
      user_id: string | null
    },
  ) {
    setSaving(true)
    setError(null)
    try {
      await updateStudent(id, data)
      setEditingId(null)
      load()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  /**
   * The pool for the "link self-login" picker, scoped to whichever
   * student is being edited. `student.user` carries the currently-linked
   * account's own name/email — already joined by `fetchAllStudents`, so
   * no extra query is needed to restore it — and the merge logic itself
   * lives in `src/lib/enrolmentLinks.ts` (`selfLoginAccountsToOffer`),
   * tested there rather than here (coverage is scoped to `src/lib/**`).
   */
  function unlinkedFor(student: AdminStudent): DirectoryUser[] {
    return selfLoginAccountsToOffer(
      unlinked,
      student.user_id && student.user ? { id: student.user_id, ...student.user } : null,
    )
  }

  return (
    <div className="space-y-4">
      <AdminSectionNav />
      <h1 className="text-lg font-bold text-ppme-primary">{t('admin.studentsTitle')}</h1>

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

      <div className="rounded-lg bg-white p-4 shadow-sm">
        {creating ? (
          <StudentForm
            classes={classes}
            parents={parents}
            unlinkedAccounts={unlinked}
            saving={saving}
            onSave={handleCreate}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setCreating(true)
              setEditingId(null)
            }}
            className="min-h-11 w-full rounded-lg border-2 border-dashed border-ppme-primary/30 px-4 font-semibold text-ppme-primary hover:bg-ppme-bg-alt"
          >
            + {t('admin.newStudent')}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : students.length === 0 ? (
        <p className="text-ppme-text/60">{t('common.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {students.map((s) => (
            <li key={s.id} className="rounded-lg bg-white p-4 shadow-sm">
              {editingId === s.id ? (
                <StudentForm
                  initial={s}
                  classes={classes}
                  parents={parents}
                  unlinkedAccounts={unlinkedFor(s)}
                  saving={saving}
                  onSave={(data) => void handleUpdate(s.id, data)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-ppme-text">{s.full_name}</p>
                      {/*
                        Says "has their own login", because that is the only
                        thing `user_id` records. It read "16+" until ADR-021,
                        which was a claim about the child's age that nothing
                        ever checked — `date_of_birth` sits in the same row and
                        is never consulted — so linking an account to a younger
                        santri labelled them 16+ on the one screen where the
                        enrolment decision is made. Who may hold a login is the
                        identity provider's rule (ADR-021), and this badge is
                        not the place to restate it.
                      */}
                      {s.user_id && (
                        <span className="rounded-full bg-ppme-accent/15 px-2 py-0.5 text-xs font-semibold text-ppme-primary">
                          {t('admin.hasOwnLogin')}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-ppme-text/60">
                      {s.class?.name ?? '—'} · {s.parent?.full_name ?? '—'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(s.id)
                      setCreating(false)
                    }}
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
