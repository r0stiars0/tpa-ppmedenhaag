import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AdminSectionNav } from '../../components/AdminSectionNav'
import { getErrorMessage } from '../../lib/errors'
import { TUTOR_LINK_ROLES } from '../../lib/enrolmentLinks'
import { murajaahImpact, type TargetImpact } from '../../lib/groups'
import {
  addClassMembers,
  closeMurajaahTargets,
  fetchActiveMurajaahTargets,
  fetchAllClasses,
  fetchAllStudents,
  fetchUsersForLink,
  removeClassMembers,
  type ActiveMurajaahTarget,
  type AdminClass,
  type AdminStudent,
  type DirectoryUser,
} from './api'
import { MurajaahTargetPrompt } from './MurajaahTargetPrompt'

const ANY = ''
const NO_GROUP = 'none'

interface PendingPrompt {
  impacts: TargetImpact[]
  targets: ActiveMurajaahTarget[]
  run: (closeIds: string[]) => Promise<void>
}

/**
 * One group's members, and adding many students at once (PRD Feature 8
 * FR-009). At the start of the year an admin opens an Aqidah group,
 * filters by date of birth, ticks the children and saves once — instead
 * of editing forty student records one by one.
 *
 * Filtering by birthdate is a tool for the admin, not a placement
 * suggestion: nothing here proposes a group (PRD non-goal 1).
 *
 * Enrolment gives the group's tutors access to a child's records, so a
 * bulk save states who gains access before it is sent, and every change
 * is written to the admin audit log by trigger (Resolved Decision 25).
 */
export function GroupMembersPage() {
  const { t, i18n } = useTranslation()
  const { id: classId = '' } = useParams()
  const [cls, setCls] = useState<AdminClass | null>(null)
  const [classes, setClasses] = useState<AdminClass[]>([])
  const [students, setStudents] = useState<AdminStudent[]>([])
  const [tutors, setTutors] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [nameFilter, setNameFilter] = useState('')
  const [bornFrom, setBornFrom] = useState('')
  const [bornTo, setBornTo] = useState('')
  const [groupFilter, setGroupFilter] = useState(ANY)
  const [prompt, setPrompt] = useState<PendingPrompt | null>(null)

  function load() {
    setLoading(true)
    setError(null)
    Promise.all([fetchAllClasses(), fetchAllStudents(), fetchUsersForLink(TUTOR_LINK_ROLES)])
      .then(([classData, studentData, tutorData]) => {
        setClasses(classData)
        setCls(classData.find((c) => c.id === classId) ?? null)
        setStudents(studentData)
        setTutors(tutorData)
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [classId])

  const isMember = (s: AdminStudent) => s.memberships.some((m) => m.class_id === classId)
  const members = useMemo(() => students.filter(isMember), [students, classId])
  const archived = cls?.archived_at != null

  const candidates = useMemo(() => {
    const name = nameFilter.trim().toLowerCase()
    return students
      .filter((s) => !isMember(s))
      .filter((s) => !name || s.full_name.toLowerCase().includes(name))
      .filter((s) => !bornFrom || s.date_of_birth >= bornFrom)
      .filter((s) => !bornTo || s.date_of_birth <= bornTo)
      .filter((s) => {
        if (groupFilter === ANY) return true
        const active = s.groups.filter((g) => !g.archived)
        if (groupFilter === NO_GROUP) return active.length === 0
        return active.some((g) => g.id === groupFilter)
      })
  }, [students, classId, nameFilter, bornFrom, bornTo, groupFilter])

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language === 'nl' ? 'nl-NL' : 'id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
    [i18n.language],
  )
  const formatDob = (dob: string) => dateFormatter.format(new Date(`${dob}T00:00:00`))
  const tutorNames = (cls?.tutor_ids ?? [])
    .map((id) => tutors.find((u) => u.id === id)?.full_name)
    .filter(Boolean)
    .join(', ')

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

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleAdd() {
    if (!cls || selected.size === 0) return
    // Stated before sending: enrolment is a grant of access to children's
    // records, not a label (Resolved Decision 25).
    const summary = t('admin.bulkAddConfirm', {
      count: selected.size,
      group: cls.name,
      tutors: tutorNames || t('admin.noTutors'),
    })
    if (!window.confirm(summary)) return
    void runSaving(async () => {
      await addClassMembers(classId, [...selected])
      setSelected(new Set())
      setAdding(false)
      load()
    })
  }

  function handleRemove(student: AdminStudent) {
    if (!cls) return
    if (!window.confirm(t('admin.confirmRemoveMember', { name: student.full_name, group: cls.name }))) return
    const remove = async (closeIds: string[]) => {
      await removeClassMembers(classId, [student.id])
      await closeMurajaahTargets(closeIds)
      setPrompt(null)
      load()
    }
    void runSaving(async () => {
      // Taking a child out of their last tracking group would orphan their
      // Murajaah targets (PRD Feature 8 FR-001).
      if (!cls.tracks_progress) return remove([])
      const targets = await fetchActiveMurajaahTargets([student.id])
      const impacts = murajaahImpact(targets, student.memberships, {
        kind: 'removeMembers',
        classId,
        studentIds: [student.id],
      })
      if (impacts.length > 0) setPrompt({ impacts, targets, run: remove })
      else await remove([])
    })
  }

  if (loading) return <p className="text-ppme-text/60">{t('common.loading')}</p>

  return (
    <div className="space-y-4">
      <AdminSectionNav />
      <Link to="/admin/classes" className="inline-flex min-h-11 items-center text-sm font-medium text-ppme-primary">
        ← {t('admin.classesTitle')}
      </Link>

      {!cls ? (
        <p className="text-ppme-text/60">{t('admin.groupNotFound')}</p>
      ) : (
        <>
          <div>
            <h1 className="text-lg font-bold text-ppme-primary">{cls.name}</h1>
            <p className="text-sm text-ppme-text/60">{tutorNames || t('admin.noTutors')}</p>
          </div>

          {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}
          {archived && (
            <p className="rounded-lg bg-ppme-text/5 p-3 text-sm text-ppme-text/80">{t('admin.archivedGroupFrozen')}</p>
          )}

          {prompt && (
            <MurajaahTargetPrompt
              impacts={prompt.impacts}
              targets={prompt.targets}
              busy={saving}
              onConfirm={(closeIds) => void runSaving(() => prompt.run(closeIds))}
              onCancel={() => setPrompt(null)}
            />
          )}

          {!archived && (
            <div className="rounded-lg bg-white p-4 shadow-sm">
              {!adding ? (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="min-h-11 w-full rounded-lg border-2 border-dashed border-ppme-primary/30 px-4 font-semibold text-ppme-primary hover:bg-ppme-bg-alt"
                >
                  + {t('admin.addStudents')}
                </button>
              ) : (
                <div className="space-y-3">
                  <h2 className="font-semibold text-ppme-text">{t('admin.addStudents')}</h2>
                  <p className="text-xs text-ppme-text/60">{t('admin.addStudentsHint')}</p>
                  <label className="block text-xs font-medium text-ppme-text/70">
                    {t('admin.filterName')}
                    <input
                      type="search"
                      value={nameFilter}
                      onChange={(e) => setNameFilter(e.target.value)}
                      className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-medium text-ppme-text/70">
                      {t('admin.bornFrom')}
                      <input
                        type="date"
                        value={bornFrom}
                        onChange={(e) => setBornFrom(e.target.value)}
                        className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
                      />
                    </label>
                    <label className="text-xs font-medium text-ppme-text/70">
                      {t('admin.bornTo')}
                      <input
                        type="date"
                        value={bornTo}
                        onChange={(e) => setBornTo(e.target.value)}
                        className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
                      />
                    </label>
                  </div>
                  <label className="block text-xs font-medium text-ppme-text/70">
                    {t('admin.filterCurrentGroup')}
                    <select
                      value={groupFilter}
                      onChange={(e) => setGroupFilter(e.target.value)}
                      className="mt-1 min-h-11 w-full rounded-lg border border-black/10 bg-white px-3 text-sm text-ppme-text"
                    >
                      <option value={ANY}>{t('admin.allGroups')}</option>
                      <option value={NO_GROUP}>{t('admin.noGroup')}</option>
                      {classes
                        .filter((c) => c.archived_at === null && c.id !== classId)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>

                  {candidates.length === 0 ? (
                    <p className="text-sm text-ppme-text/60">{t('common.empty')}</p>
                  ) : (
                    <ul className="max-h-96 space-y-1 overflow-y-auto">
                      {candidates.map((s) => (
                        <li key={s.id}>
                          <label className="flex min-h-11 items-center gap-2 text-sm text-ppme-text">
                            <input
                              type="checkbox"
                              checked={selected.has(s.id)}
                              onChange={() => toggle(s.id)}
                              className="h-4 w-4"
                            />
                            <span>
                              {s.full_name}
                              <span className="block text-xs text-ppme-text/60">
                                {formatDob(s.date_of_birth)}
                                {' · '}
                                {s.groups.some((g) => !g.archived)
                                  ? s.groups.filter((g) => !g.archived).map((g) => g.name).join(', ')
                                  : t('admin.noGroup')}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={saving || selected.size === 0}
                      onClick={handleAdd}
                      className="min-h-11 flex-1 rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
                    >
                      {saving ? t('common.loading') : t('admin.addSelected', { count: selected.size })}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdding(false)
                        setSelected(new Set())
                      }}
                      className="min-h-11 rounded-lg border border-black/10 px-4 font-semibold text-ppme-text"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ppme-text/70">
              {t('admin.groupMembers', { count: members.length })}
            </h2>
            {members.length === 0 ? (
              <p className="text-ppme-text/60">{t('common.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {members.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-white p-3 shadow-sm">
                    <div>
                      <p className="text-sm font-medium text-ppme-text">{s.full_name}</p>
                      <p className="text-xs text-ppme-text/60">{formatDob(s.date_of_birth)}</p>
                    </div>
                    {!archived && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleRemove(s)}
                        className="min-h-11 shrink-0 rounded-md px-3 text-sm font-medium text-ppme-danger hover:bg-ppme-danger/10 disabled:opacity-50"
                      >
                        {t('admin.removeMember')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
