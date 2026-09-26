import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AdminSectionNav } from '../../components/AdminSectionNav'
import { getErrorMessage } from '../../lib/errors'
import { murajaahImpact, type GroupChange, type MembershipRow, type TargetImpact } from '../../lib/groups'
import {
  classHasHistory,
  closeMurajaahTargets,
  createClass,
  deleteClass,
  fetchActiveMurajaahTargets,
  fetchAllClasses,
  fetchAllMemberships,
  fetchUsersForLink,
  hasRecentSession,
  setClassArchived,
  updateClass,
  type ActiveMurajaahTarget,
  type AdminClass,
  type DirectoryUser,
} from './api'
import { TUTOR_LINK_ROLES } from '../../lib/enrolmentLinks'
import { formatDayList } from '../../lib/weekdays'
import { ClassForm, type ClassFormValue } from './ClassForm'
import { MurajaahTargetPrompt } from './MurajaahTargetPrompt'
import { todayLocalDate } from '../attendance/api'

interface PendingPrompt {
  impacts: TargetImpact[]
  targets: ActiveMurajaahTarget[]
  run: (closeIds: string[]) => Promise<void>
}

function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

export function ClassesPage() {
  const { t } = useTranslation()
  const [classes, setClasses] = useState<AdminClass[]>([])
  const [memberships, setMemberships] = useState<MembershipRow[]>([])
  const [tutors, setTutors] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [prompt, setPrompt] = useState<PendingPrompt | null>(null)

  function load() {
    setLoading(true)
    setError(null)
    // Not just `role = 'tutor'`: an admin teaches (ADR-014) and a 16+
    // santri may assist the class they attend (ADR-020, RLS-35), which
    // until now no admin screen could set up (ADR-028).
    Promise.all([fetchAllClasses(), fetchUsersForLink(TUTOR_LINK_ROLES), fetchAllMemberships()])
      .then(([classData, tutorData, memberData]) => {
        setClasses(classData)
        setTutors(tutorData)
        setMemberships(memberData)
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const memberCount = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of memberships) counts.set(row.class_id, (counts.get(row.class_id) ?? 0) + 1)
    return counts
  }, [memberships])

  const shown = classes.filter((c) => (c.archived_at !== null) === showArchived)

  async function runSaving(work: () => Promise<void>) {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await work()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  /**
   * Switching a group's tracking off or archiving a tracking group can
   * leave its members' Murajaah targets with no tutor who may manage them
   * (PRD Feature 8 FR-001). The admin decides close-or-keep first; the
   * change and the chosen closures run only then.
   */
  async function withMurajaahCheck(classId: string, change: GroupChange, run: (closeIds: string[]) => Promise<void>) {
    const studentIds = memberships.filter((m) => m.class_id === classId).map((m) => m.student_id)
    const targets = await fetchActiveMurajaahTargets(studentIds)
    const impacts = murajaahImpact(targets, memberships, change)
    if (impacts.length > 0) setPrompt({ impacts, targets, run })
    else await run([])
  }

  function handleCreate(data: ClassFormValue) {
    void runSaving(async () => {
      const created = await createClass(data)
      setClasses((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setCreating(false)
    })
  }

  function handleUpdate(cls: AdminClass, data: ClassFormValue) {
    const save = async (closeIds: string[]) => {
      const updated = await updateClass(cls.id, data)
      await closeMurajaahTargets(closeIds)
      setClasses((prev) => prev.map((c) => (c.id === cls.id ? updated : c)))
      setPrompt(null)
      setEditingId(null)
      load()
    }
    void runSaving(async () => {
      if (cls.tracks_progress && !data.tracks_progress) {
        await withMurajaahCheck(cls.id, { kind: 'trackingOff', classId: cls.id }, save)
      } else {
        await save([])
      }
    })
  }

  function handleArchive(cls: AdminClass) {
    void runSaving(async () => {
      const recent = await hasRecentSession(cls.id, daysBefore(todayLocalDate(), 7))
      const lines = [t('admin.confirmArchive', { name: cls.name })]
      if (recent) lines.push(t('admin.archiveRecentSessionWarning'))
      if (!window.confirm(lines.join('\n\n'))) return
      const archive = async (closeIds: string[]) => {
        await setClassArchived(cls.id, true)
        await closeMurajaahTargets(closeIds)
        setPrompt(null)
        load()
      }
      if (cls.tracks_progress) await withMurajaahCheck(cls.id, { kind: 'archive', classId: cls.id }, archive)
      else await archive([])
    })
  }

  function handleUnarchive(cls: AdminClass) {
    if (!window.confirm(t('admin.confirmUnarchive', { name: cls.name }))) return
    void runSaving(async () => {
      await setClassArchived(cls.id, false)
      load()
    })
  }

  /**
   * Delete is for a group created by mistake. One with any session or
   * homework must be archived instead: the database refuses the delete
   * (migration 026 made it RESTRICT), and it would have erased history.
   */
  function handleDelete(cls: AdminClass) {
    void runSaving(async () => {
      if (await classHasHistory(cls.id)) {
        setNotice(t('admin.cannotDeleteGroupWithHistory', { name: cls.name }))
        return
      }
      if (!window.confirm(t('admin.confirmDeleteGroup', { name: cls.name }))) return
      await deleteClass(cls.id)
      load()
    })
  }

  function tutorNames(tutorIds: string[]) {
    if (tutorIds.length === 0) return t('admin.noTutors')
    return tutorIds.map((id) => tutors.find((t) => t.id === id)?.full_name ?? '?').join(', ')
  }

  const actionClass = 'min-h-11 shrink-0 rounded-md px-3 text-sm font-medium hover:bg-ppme-bg-alt'

  return (
    <div className="space-y-4">
      <AdminSectionNav />
      <h1 className="text-lg font-bold text-ppme-primary">{t('admin.classesTitle')}</h1>

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}
      {notice && <p className="rounded-lg bg-ppme-accent/15 p-3 text-sm text-ppme-text">{notice}</p>}

      {prompt && (
        <MurajaahTargetPrompt
          impacts={prompt.impacts}
          targets={prompt.targets}
          busy={saving}
          onConfirm={(closeIds) => void runSaving(() => prompt.run(closeIds))}
          onCancel={() => setPrompt(null)}
        />
      )}

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

      <div className="flex gap-2" role="group" aria-label={t('admin.groupStatusFilter')}>
        {[false, true].map((archived) => (
          <button
            key={String(archived)}
            type="button"
            aria-pressed={showArchived === archived}
            onClick={() => setShowArchived(archived)}
            className={`min-h-11 rounded-full px-4 text-sm font-medium ${
              showArchived === archived ? 'bg-ppme-primary text-white' : 'bg-white text-ppme-text/70 shadow-sm'
            }`}
          >
            {archived ? t('admin.archivedGroups') : t('admin.activeGroups')}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : shown.length === 0 ? (
        <p className="text-ppme-text/60">{t('admin.noClasses')}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((cls) => (
            <li key={cls.id} className="rounded-lg bg-white p-4 shadow-sm">
              {editingId === cls.id ? (
                <ClassForm
                  initial={cls}
                  tutors={tutors}
                  saving={saving}
                  onSave={(data) => handleUpdate(cls, data)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="space-y-2">
                  <div>
                    {/* Name on the left, badges right-aligned on the same line. */}
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-ppme-text">{cls.name}</p>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        {!cls.tracks_progress && (
                          <span className="rounded-full bg-ppme-text/10 px-2 py-0.5 text-xs text-ppme-text/70">
                            {t('admin.noProgressTracking')}
                          </span>
                        )}
                        {cls.archived_at && (
                          <span className="rounded-full bg-ppme-text/10 px-2 py-0.5 text-xs text-ppme-text/70">
                            {t('admin.archivedBadge')}
                          </span>
                        )}
                      </div>
                    </div>
                    {cls.schedule && <p className="text-sm text-ppme-text/60">{cls.schedule}</p>}
                    <p className="text-xs text-ppme-text/60">{formatDayList(cls.meeting_days, t)}</p>
                    <p className="mt-1 text-xs text-ppme-text/50">{tutorNames(cls.tutor_ids)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Link to={`/admin/classes/${cls.id}`} className={`${actionClass} flex items-center text-ppme-primary`}>
                      {t('admin.groupMembers', { count: memberCount.get(cls.id) ?? 0 })}
                    </Link>
                    {cls.archived_at ? (
                      <button type="button" disabled={saving} onClick={() => handleUnarchive(cls)} className={`${actionClass} text-ppme-primary`}>
                        {t('admin.unarchive')}
                      </button>
                    ) : (
                      <>
                        <button type="button" onClick={() => setEditingId(cls.id)} className={`${actionClass} text-ppme-primary`}>
                          {t('common.edit')}
                        </button>
                        <button type="button" disabled={saving} onClick={() => handleArchive(cls)} className={`${actionClass} text-ppme-text/80`}>
                          {t('admin.archive')}
                        </button>
                      </>
                    )}
                    <button type="button" disabled={saving} onClick={() => handleDelete(cls)} className={`${actionClass} text-ppme-danger hover:bg-ppme-danger/10`}>
                      {t('admin.deleteGroup')}
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
