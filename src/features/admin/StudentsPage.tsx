import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { murajaahImpact, type TargetImpact } from '../../lib/groups'
import { AdminSectionNav } from '../../components/AdminSectionNav'
import { getErrorMessage } from '../../lib/errors'
import { PARENT_LINK_ROLES, selfLoginAccountsToOffer } from '../../lib/enrolmentLinks'
import {
  closeMurajaahTargets,
  deleteStudent,
  fetchActiveMurajaahTargets,
  fetchAllClasses,
  fetchAllStudents,
  fetchUnlinkedStudentAccounts,
  fetchUsersForLink,
  saveStudent,
  type ActiveMurajaahTarget,
  type AdminClass,
  type AdminStudent,
  type DirectoryUser,
} from './api'
import { MurajaahTargetPrompt } from './MurajaahTargetPrompt'
import { StudentForm, type StudentFormValue } from './StudentForm'

/** The Santri list's group filter: every student, those in no group, or one group's members. */
const ALL = ''
const NO_GROUP = 'none'

interface PendingPrompt {
  impacts: TargetImpact[]
  targets: ActiveMurajaahTarget[]
  run: (closeIds: string[]) => Promise<void>
}

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
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<PendingPrompt | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const groupFilter = searchParams.get('group') ?? ALL

  const visible = useMemo(() => {
    if (groupFilter === ALL) return students
    if (groupFilter === NO_GROUP) return students.filter((s) => s.groups.every((g) => g.archived))
    return students.filter((s) => s.groups.some((g) => g.id === groupFilter))
  }, [students, groupFilter])

  function setGroupFilter(value: string) {
    setSearchParams(value === ALL ? {} : { group: value }, { replace: true })
  }

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

  async function handleCreate(data: StudentFormValue) {
    setSaving(true)
    setError(null)
    try {
      await saveStudent(data)
      setCreating(false)
      load()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function runSaving(work: () => Promise<void>) {
    setSaving(true)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  /**
   * Saving a student's group set can take them out of their last group
   * with tracking on, which would orphan their Murajaah targets (PRD
   * Feature 8 FR-001). Asked first; the save and the chosen closures run
   * only once the admin has decided.
   */
  function handleUpdate(id: string, data: StudentFormValue) {
    const student = students.find((s) => s.id === id)
    const save = async (closeIds: string[]) => {
      await saveStudent({ ...data, id })
      await closeMurajaahTargets(closeIds)
      setPrompt(null)
      setEditingId(null)
      load()
    }
    void runSaving(async () => {
      const trackingClassIds = data.class_ids.filter((cid) =>
        classes.some((c) => c.id === cid && c.tracks_progress && c.archived_at === null),
      )
      const targets = await fetchActiveMurajaahTargets([id])
      const impacts = murajaahImpact(targets, student?.memberships ?? [], {
        kind: 'setGroups',
        studentId: id,
        trackingClassIds,
      })
      if (impacts.length > 0) setPrompt({ impacts, targets, run: save })
      else await save([])
    })
  }

  async function handleDelete(student: AdminStudent) {
    if (!window.confirm(t('admin.confirmDeleteStudent', { name: student.full_name }))) return
    setDeletingId(student.id)
    setError(null)
    try {
      await deleteStudent(student.id)
      load()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setDeletingId(null)
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

      {prompt && (
        <MurajaahTargetPrompt
          impacts={prompt.impacts}
          targets={prompt.targets}
          busy={saving}
          onConfirm={(closeIds) => void runSaving(() => prompt.run(closeIds))}
          onCancel={() => setPrompt(null)}
        />
      )}

      <label className="block text-xs font-medium text-ppme-text/70">
        {t('admin.filterByGroup')}
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-black/10 bg-white px-3 text-sm text-ppme-text"
        >
          <option value={ALL}>{t('admin.allGroups')}</option>
          <option value={NO_GROUP}>{t('admin.noGroup')}</option>
          {classes
            .filter((c) => c.archived_at === null)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>

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
      ) : visible.length === 0 ? (
        <p className="text-ppme-text/60">{t('common.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((s) => (
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
                      {s.groups.some((g) => !g.archived)
                        ? s.groups
                            .filter((g) => !g.archived)
                            .map((g) => g.name)
                            .join(', ')
                        : t('admin.noGroup')}{' '}
                      ·{' '}
                      {s.guardians.length > 0
                        ? s.guardians.map((g) => g.full_name).join(', ')
                        : '—'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(s.id)
                        setCreating(false)
                      }}
                      className="min-h-11 rounded-md px-3 text-sm font-medium text-ppme-primary hover:bg-ppme-bg-alt"
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      disabled={deletingId === s.id}
                      onClick={() => void handleDelete(s)}
                      className="min-h-11 rounded-md px-3 text-sm font-medium text-ppme-danger hover:bg-ppme-danger/10 disabled:opacity-50"
                    >
                      {deletingId === s.id ? t('common.loading') : t('admin.deleteStudent')}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
