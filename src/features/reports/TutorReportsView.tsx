import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useMyClasses } from '../../hooks/useMyClasses'
import { ClassPicker } from '../../components/ClassPicker'
import { fetchRecordableRoster, type RosterStudent } from '../../lib/roster'
import { useViewScope } from '../../context/ViewScopeContext'
import { getErrorMessage } from '../../lib/errors'
import { fetchMyReportSections, fetchReportsForStudents, type MyReportSection, type YearEndReport } from './api'
import { SectionForm, isSectionComplete } from './SectionForm'
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
 *   - admin can also publish (PRD Feature 8 Resolved Decision 34; until
 *     release 8b-2 only the authoring tutor could).
 *
 * A group with tracking off (an Aqidah group) also lists the SECTIONS its
 * tutors write on reports they cannot open themselves — a child who is
 * in a Yanbu'a group too has their report authored there (FR-008).
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
  const [sections, setSections] = useState<MyReportSection[]>([])
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
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
    setSelectedSectionId(null)
    fetchRecordableRoster(classId, selfStudentId)
      .then(async (students) => {
        const [data, groupSections] = await Promise.all([
          fetchReportsForStudents(students.map((s) => s.id)),
          fetchMyReportSections(classId),
        ])
        if (!active) return
        setRoster(students)
        setReports(data)
        setSections(groupSections)
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
  }, [classId, reloadToken, selfStudentId])

  const handleGenerated = useCallback(() => setReloadToken((n) => n + 1), [])

  const nameById = new Map(roster.map((s) => [s.id, s.full_name]))
  const selected = reports.find((r) => r.id === selectedId) ?? null

  function handleSaved(saved: YearEndReport) {
    setReports((prev) => prev.map((r) => (r.id === saved.id ? saved : r)))
  }

  if (classesLoading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (classes.length === 0) return <p className="text-ppme-text/60">{t('common.noClassesAssigned')}</p>

  const selectedSection = sections.find((s) => s.section_id === selectedSectionId) ?? null
  if (selectedSection) {
    const locked = selectedSection.report_status !== 'draft' && !isAdmin
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setSelectedSectionId(null)} className="min-h-11 text-sm font-medium text-ppme-primary">
          ← {t('common.back')}
        </button>
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-ppme-text">{selectedSection.student_name}</h2>
            <p className="text-xs text-ppme-text/60">{t('reports.academicYear', { year: selectedSection.academic_year })}</p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASS[selectedSection.report_status]}`}>
            {t(STATUS_LABEL_KEY[selectedSection.report_status])}
          </span>
        </div>
        <section className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-ppme-text">
            {t('reports.sectionOf', { group: classes.find((c) => c.id === classId)?.name ?? '' })}
          </h3>
          <SectionForm
            section={{ id: selectedSection.section_id, ...selectedSection, attendance_rate: Number(selectedSection.attendance_rate) }}
            editable={!locked}
            onSaved={(value) =>
              setSections((prev) => prev.map((s) => (s.section_id === selectedSection.section_id ? { ...s, ...value } : s)))
            }
          />
        </section>
        <p className="rounded-lg bg-ppme-primary/10 p-3 text-sm text-ppme-text">
          {locked
            ? t('reports.sectionLockedNote')
            : t('reports.sectionOnlyYours', { author: selectedSection.author_name ?? t('reports.authoringTutor') })}
        </p>
      </div>
    )
  }

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
          canPublish={isAuthoringTutor || isAdmin}
          isAdmin={isAdmin}
          myClassIds={classes.map((c) => c.id)}
          selfStudentId={selfStudentId}
          onSaved={handleSaved}
        />
      </div>
    )
  }

  // Sections on reports this tutor can open are edited inside the report;
  // the rest are listed on their own (screen "Bagian Aqidah").
  const readableReportIds = new Set(reports.map((r) => r.id))
  const sectionRows = isAdmin ? [] : sections.filter((s) => !readableReportIds.has(s.report_id))
  const sectionBadge = (s: MyReportSection) =>
    s.report_status !== 'draft'
      ? { label: t('reports.sectionPublishedLocked'), cls: 'bg-ppme-success/10 text-ppme-success' }
      : isSectionComplete(s)
        ? { label: t('reports.sectionFilled'), cls: 'bg-ppme-primary/10 text-ppme-primary' }
        : { label: t('reports.sectionEmpty'), cls: 'bg-ppme-bg-alt text-ppme-text/70' }

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
      ) : sorted.length === 0 && sectionRows.length === 0 ? (
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
          {sectionRows.map((s) => {
            const badge = sectionBadge(s)
            return (
              <li key={s.section_id}>
                <button
                  type="button"
                  onClick={() => setSelectedSectionId(s.section_id)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg bg-white p-4 text-left shadow-sm hover:bg-ppme-bg-alt"
                >
                  <span>
                    <span className="block font-medium text-ppme-text">{s.student_name}</span>
                    <span className="block text-xs text-ppme-text/60">
                      {t('reports.academicYear', { year: s.academic_year })} ·{' '}
                      {t('reports.authorIs', { name: s.author_name ?? '—' })}
                    </span>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>{badge.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
