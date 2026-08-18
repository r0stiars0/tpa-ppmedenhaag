import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useMyClasses } from '../../hooks/useMyClasses'
import { ClassPicker } from '../../components/ClassPicker'
import { fetchRecordableRoster, type RosterStudent } from '../../lib/roster'
import { useViewScope } from '../../context/ViewScopeContext'
import { getErrorMessage } from '../../lib/errors'
import { fetchReportsForStudents, fetchTutorNames, type YearEndReport } from './api'
import { GenerateDraftsPanel } from './GenerateDraftsPanel'
import { ReportEditor } from './ReportEditor'
import { STATUS_BADGE_CLASS, STATUS_LABEL_KEY } from './grade'

/**
 * FR-002 — the staff review queue: every report belonging to a student
 * in the selected class, drafts included.
 *
 * Used by tutors (own classes, `yer_tutor_rw` / RLS-15) and, since
 * ADR-014, by admin (every class, `yer_admin_all`). The two differ in
 * exactly two places, both derived below rather than duplicated into a
 * second screen:
 *
 *   - admin can edit any report in any class, where a tutor can only
 *     edit the ones they authored (`yer_tutor_rw`'s WITH CHECK pins
 *     `tutor_id = auth.uid()`, so a co-tutor is read-only);
 *   - admin can never publish. Publishing is what makes a report visible
 *     to a family — an authoring act, kept with the authoring tutor, and
 *     `publish-report` still 403s anyone else. That combination is why
 *     admin edits carry a warning about the stored PDF; see ReportEditor.
 *
 * Reports are never created by hand here. Generation stays a bulk,
 * enrollment-wide operation, which only admin can trigger — from the
 * panel above the list rather than the separate `/admin/reports` screen
 * it lived on before ADR-014.
 */
export function TutorReportsView() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const { classes, loading: classesLoading } = useMyClasses()
  const { selfStudentId } = useViewScope()
  const isAdmin = profile?.role === 'admin'

  const [classId, setClassId] = useState<string | null>(null)
  const [roster, setRoster] = useState<RosterStudent[]>([])
  const [reports, setReports] = useState<YearEndReport[]>([])
  const [tutorNames, setTutorNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!classId && classes.length > 0) setClassId(classes[0].id)
  }, [classes, classId])

  useEffect(() => {
    if (!classId) return
    let active = true
    setLoading(true)
    setError(null)
    setSelectedId(null)
    fetchRecordableRoster(classId, selfStudentId)
      .then(async (students) => {
        const data = await fetchReportsForStudents(students.map((s) => s.id))
        // Only admin can resolve another user's name (`users_self_read`
        // is self-or-admin), and only admin needs to: it's the role that
        // has to be told whose re-publish a stale PDF is waiting on.
        const names = isAdmin ? await fetchTutorNames(data.map((r) => r.tutor_id)) : new Map<string, string>()
        if (!active) return
        setRoster(students)
        setReports(data)
        setTutorNames(names)
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [classId, isAdmin, reloadToken, selfStudentId])

  const handleGenerated = useCallback(() => setReloadToken((n) => n + 1), [])

  const nameById = new Map(roster.map((s) => [s.id, s.full_name]))
  const selected = reports.find((r) => r.id === selectedId) ?? null

  function handleSaved(saved: YearEndReport) {
    setReports((prev) => prev.map((r) => (r.id === saved.id ? saved : r)))
  }

  if (classesLoading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (classes.length === 0) return <p className="text-ppme-text/60">{t('common.noClassesAssigned')}</p>

  if (selected) {
    const isAuthoringTutor = selected.tutor_id === profile?.id
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          className="min-h-11 text-sm font-medium text-ppme-primary"
        >
          ← {t('common.back')}
        </button>
        <ReportEditor
          report={selected}
          studentName={nameById.get(selected.student_id) ?? '—'}
          canEdit={isAdmin || isAuthoringTutor}
          canPublish={isAuthoringTutor}
          authoringTutorName={tutorNames.get(selected.tutor_id) ?? null}
          onSaved={handleSaved}
        />
      </div>
    )
  }

  const sorted = [...reports].sort((a, b) => {
    const byName = (nameById.get(a.student_id) ?? '').localeCompare(nameById.get(b.student_id) ?? '')
    return byName !== 0 ? byName : b.academic_year.localeCompare(a.academic_year)
  })

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-ppme-primary">{t('reports.title')}</h1>

      {isAdmin && <GenerateDraftsPanel classes={classes} onGenerated={handleGenerated} />}

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <ClassPicker classes={classes} value={classId} onChange={setClassId} />
      </div>

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

      {loading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : sorted.length === 0 ? (
        <p className="rounded-lg bg-white p-6 text-center text-ppme-text/60 shadow-sm">
          {t('reports.noDraftsForClass')}
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((report) => (
            <li key={report.id}>
              <button
                type="button"
                onClick={() => setSelectedId(report.id)}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg bg-white p-4 text-left shadow-sm hover:bg-ppme-bg-alt"
              >
                <span>
                  <span className="block font-medium text-ppme-text">
                    {nameById.get(report.student_id) ?? '—'}
                  </span>
                  <span className="block text-xs text-ppme-text/60">
                    {t('reports.academicYear', { year: report.academic_year })}
                  </span>
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASS[report.status]}`}
                >
                  {t(STATUS_LABEL_KEY[report.status])}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
