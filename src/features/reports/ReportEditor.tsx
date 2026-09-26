import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { REPORT_GRADE_OPTIONS, type ReportGrade } from '../../lib/reports'
import { getErrorMessage } from '../../lib/errors'
import {
  fetchAuthorCandidates,
  fetchReportSections,
  publishReport,
  updateReport,
  updateReportAuthor,
  type ReportEdit,
  type ReportSection,
  type YearEndReport,
} from './api'
import { ReportSectionsCard } from './ReportSectionsCard'
import { isSectionComplete } from './SectionForm'
import { AttendanceSummaryCard } from './AttendanceSummaryCard'
import { DownloadPdfButton } from './DownloadPdfButton'
import { ProgressContextCard } from './ProgressContextCard'
import { GRADE_LABEL_KEY, STATUS_BADGE_CLASS, STATUS_LABEL_KEY } from './grade'

interface ReportEditorProps {
  report: YearEndReport
  studentName: string
  /**
   * False for a co-tutor on the same class: `yer_tutor_rw`'s WITH CHECK
   * requires `tutor_id = auth.uid()`, so they can read a colleague's
   * report but any edit would be rejected by RLS. The form renders
   * read-only rather than letting them type into fields that would 403 on
   * save (one authoring tutor per report — PRD 6.5 non-goal #2).
   *
   * True for admin on every report (`yer_admin_all`, ADR-014).
   */
  canEdit: boolean
  /**
   * The report's author or an admin (PRD Feature 8 Resolved Decision 34,
   * TAD ADR-045(h)). Until release 8b-2 this was the authoring tutor
   * only (ADR-013, kept by ADR-014); `publish-report` now accepts an
   * admin too, so an admin's edit can regenerate the PDF itself.
   */
  canPublish: boolean
  /** Admin: may leave empty sections out and change the author. */
  isAdmin: boolean
  /** Groups the caller teaches: a section of one of them is theirs to write. */
  myClassIds: readonly string[]
  /** The caller's own student record, if any: never theirs to grade. */
  selfStudentId: string | null
  onSaved: (report: YearEndReport) => void
}

/** FR-002 review/edit + FR-003 publish + FR-006 re-publish after an edit. */
export function ReportEditor({
  report,
  studentName,
  canEdit,
  canPublish,
  isAdmin,
  myClassIds,
  selfStudentId,
  onSaved,
}: ReportEditorProps) {
  const { t } = useTranslation()

  const [form, setForm] = useState<ReportEdit>({
    narrative: report.narrative,
    yanbua_grade: report.yanbua_grade,
    yanbua_notes: report.yanbua_notes,
    quran_grade: report.quran_grade,
    quran_notes: report.quran_notes,
    murajaah_grade: report.murajaah_grade,
    murajaah_notes: report.murajaah_notes,
    overall_grade: report.overall_grade,
  })
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isPublished = report.status === 'published'
  const hasNarrative = Boolean(form.narrative?.trim())

  const [sections, setSections] = useState<ReportSection[]>([])
  const [authors, setAuthors] = useState<{ id: string; name: string; group: string }[]>([])
  const [omitOpen, setOmitOpen] = useState(false)
  const [omitConfirmed, setOmitConfirmed] = useState(false)

  useEffect(() => {
    let active = true
    fetchReportSections(report.id)
      .then((rows) => active && setSections(rows))
      .catch((err) => active && setError(getErrorMessage(err)))
    if (isAdmin && report.status === 'draft') {
      fetchAuthorCandidates(report.student_id)
        .then((rows) => active && setAuthors(rows))
        .catch(() => undefined)
    }
    return () => {
      active = false
    }
  }, [report.id, report.student_id, report.status, isAdmin])

  const emptySections = sections.filter((s) => !isSectionComplete(s))
  const canEditSection = (section: ReportSection) =>
    isAdmin ||
    (report.status === 'draft' && myClassIds.includes(section.class_id) && report.student_id !== selfStudentId)

  async function handleAuthorChange(tutorId: string) {
    setError(null)
    try {
      onSaved(await updateReportAuthor(report.id, tutorId))
      setMessage(t('reports.authorChanged'))
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  function set<K extends keyof ReportEdit>(key: K, value: ReportEdit[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setMessage(null)
  }

  async function handleSave(): Promise<YearEndReport | null> {
    setSaving(true)
    setError(null)
    try {
      const saved = await updateReport(report.id, form)
      onSaved(saved)
      setMessage(t('reports.saved'))
      return saved
    } catch (err) {
      setError(getErrorMessage(err))
      return null
    } finally {
      setSaving(false)
    }
  }

  /**
   * Save-then-publish in one action: the PDF is rendered server-side from
   * what's in the database, so publishing without flushing the form first
   * would silently ship the previous text. This is also the FR-006 path —
   * on an already-published report the same button regenerates the PDF in
   * place after an edit.
   */
  async function handlePublish(omitEmptySections = false) {
    if (!omitEmptySections && !window.confirm(t('reports.confirmPublish'))) return
    const saved = await handleSave()
    if (!saved) return

    setPublishing(true)
    setError(null)
    try {
      const result = await publishReport(report.id, { omitEmptySections })
      setOmitOpen(false)
      onSaved({
        ...saved,
        status: 'published',
        pdf_path: result.pdf_path,
        published_at: result.published_at,
      })
      setMessage(t('reports.published'))
    } catch (err) {
      // The status flip only commits after the PDF is stored, so a
      // failure here leaves the report exactly as it was — retrying is
      // safe and needs no cleanup.
      setError(getErrorMessage(err))
    } finally {
      setPublishing(false)
    }
  }

  const busy = saving || publishing

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ppme-text">{studentName}</h2>
          <p className="text-xs text-ppme-text/60">
            {t('reports.academicYear', { year: report.academic_year })}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASS[report.status]}`}
        >
          {t(STATUS_LABEL_KEY[report.status])}
        </span>
      </div>

      {isAdmin && report.status === 'draft' && authors.length > 0 && (
        <label className="block rounded-lg bg-white p-4 text-sm font-semibold text-ppme-text shadow-sm">
          {t('reports.author')}
          <select
            value={report.tutor_id}
            onChange={(e) => void handleAuthorChange(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm font-normal text-ppme-text"
          >
            {!authors.some((a) => a.id === report.tutor_id) && <option value={report.tutor_id}>—</option>}
            {authors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {a.group}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-normal text-ppme-text/60">{t('reports.authorHint')}</span>
        </label>
      )}

      {!canEdit && (
        <p className="rounded-lg bg-ppme-bg-alt p-3 text-sm text-ppme-text/70">
          {t('reports.readOnlyOtherTutor')}
        </p>
      )}
      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}
      {message && (
        <p className="rounded-lg bg-ppme-success/10 p-3 text-sm font-medium text-ppme-success">
          {message}
        </p>
      )}

      <AttendanceSummaryCard report={report} />
      <ProgressContextCard studentId={report.student_id} />

      <section className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-ppme-text/70">{t('reports.subjectGrades')}</h3>

        <GradeField
          label={t('reports.subjectYanbua')}
          grade={form.yanbua_grade}
          notes={form.yanbua_notes}
          disabled={!canEdit || busy}
          onGrade={(g) => set('yanbua_grade', g)}
          onNotes={(n) => set('yanbua_notes', n)}
        />
        <GradeField
          label={t('reports.subjectQuran')}
          grade={form.quran_grade}
          notes={form.quran_notes}
          disabled={!canEdit || busy}
          onGrade={(g) => set('quran_grade', g)}
          onNotes={(n) => set('quran_notes', n)}
        />
        <GradeField
          label={t('reports.subjectMurajaah')}
          grade={form.murajaah_grade}
          notes={form.murajaah_notes}
          disabled={!canEdit || busy}
          onGrade={(g) => set('murajaah_grade', g)}
          onNotes={(n) => set('murajaah_notes', n)}
        />

        <label className="block text-xs font-medium text-ppme-text/70">
          {t('reports.overallGrade')}
          <GradeSelect
            value={form.overall_grade}
            disabled={!canEdit || busy}
            onChange={(g) => set('overall_grade', g)}
          />
        </label>
      </section>

      <section className="space-y-2 rounded-lg bg-white p-4 shadow-sm">
        <label className="block text-xs font-medium text-ppme-text/70">
          {t('reports.narrative')}
          <textarea
            value={form.narrative ?? ''}
            onChange={(e) => set('narrative', e.target.value)}
            placeholder={t('reports.narrativePlaceholder')}
            rows={6}
            disabled={!canEdit || busy}
            className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5 text-sm text-ppme-text disabled:bg-ppme-bg-alt"
          />
        </label>
      </section>

      <ReportSectionsCard
        sections={sections}
        canEditSection={canEditSection}
        onChanged={(id, value) => setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...value } : s)))}
      />

      {canEdit && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            className="min-h-11 w-full rounded-lg border border-ppme-primary px-4 font-semibold text-ppme-primary hover:bg-ppme-bg-alt disabled:opacity-60"
          >
            {saving ? t('common.loading') : t('common.save')}
          </button>
          {/* Hidden rather than disabled for a non-publisher: the call
              would 403 in the Function, so offering the button at all
              would be an invitation to a failure. */}
          {canPublish && emptySections.length > 0 && (
            <p role="alert" className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">
              {t('reports.sectionsMissing', { names: emptySections.map((s) => s.class?.name ?? '—').join(', ') })}
            </p>
          )}
          {canPublish && (
            <button
              type="button"
              onClick={() => void handlePublish()}
              disabled={busy || !hasNarrative || emptySections.length > 0}
              className="min-h-11 w-full rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
            >
              {publishing
                ? t('reports.generatingPdf')
                : isPublished
                  ? t('reports.republish')
                  : t('reports.publish')}
            </button>
          )}
          {canPublish && !hasNarrative && (
            <p className="text-xs text-ppme-text/60">{t('reports.narrativeRequired')}</p>
          )}
          {/* Admin only: publish with the empty sections left out, for a
              tutor who cannot finish theirs (Resolved Decision 27). */}
          {isAdmin && emptySections.length > 0 && !omitOpen && (
            <button
              type="button"
              onClick={() => setOmitOpen(true)}
              disabled={busy || !hasNarrative}
              className="min-h-11 w-full rounded-lg border border-ppme-primary px-4 font-semibold text-ppme-primary disabled:opacity-60"
            >
              {t('reports.publishWithoutEmpty')}
            </button>
          )}
          {isAdmin && omitOpen && (
            <div className="space-y-3 rounded-lg border-2 border-ppme-danger bg-white p-4">
              <p className="font-semibold text-ppme-text">{t('reports.omitTitle')}</p>
              <p className="text-sm text-ppme-text">{t('reports.omitBody')}</p>
              <ul className="list-disc rounded-lg bg-ppme-bg-alt py-2 pl-8 pr-3 text-sm">
                {emptySections.map((s) => (
                  <li key={s.id}>{s.class?.name ?? '—'}</li>
                ))}
              </ul>
              <p className="text-sm text-ppme-text/70">{t('reports.omitWhen')}</p>
              <label className="flex min-h-11 items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={omitConfirmed}
                  onChange={(e) => setOmitConfirmed(e.target.checked)}
                  className="mt-0.5 h-5 w-5"
                />
                <span>{t('reports.omitConfirm')}</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void handlePublish(true)}
                  disabled={busy || !omitConfirmed}
                  className="min-h-11 rounded-lg bg-ppme-primary font-semibold text-white disabled:opacity-60"
                >
                  {publishing ? t('reports.generatingPdf') : t('reports.publish')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOmitOpen(false)
                    setOmitConfirmed(false)
                  }}
                  className="min-h-11 rounded-lg border border-black/15 bg-white font-semibold"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Keyed on the stored object, not the status: a PDF exists or it
          doesn't, and `report-pdf` is the only thing that decides who may
          fetch it. */}
      {report.pdf_path && <DownloadPdfButton reportId={report.id} />}
    </div>
  )
}

function GradeField({
  label,
  grade,
  notes,
  disabled,
  onGrade,
  onNotes,
}: {
  label: string
  grade: ReportGrade | null
  notes: string | null
  disabled: boolean
  onGrade: (grade: ReportGrade | null) => void
  onNotes: (notes: string | null) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1 border-t border-black/5 pt-3 first:border-0 first:pt-0">
      <label className="block text-xs font-medium text-ppme-text/70">
        {label}
        <GradeSelect value={grade} disabled={disabled} onChange={onGrade} />
      </label>
      <label className="block text-xs font-medium text-ppme-text/70">
        {t('reports.subjectNotes')}
        <input
          type="text"
          value={notes ?? ''}
          onChange={(e) => onNotes(e.target.value || null)}
          disabled={disabled}
          className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text disabled:bg-ppme-bg-alt"
        />
      </label>
    </div>
  )
}

function GradeSelect({
  value,
  disabled,
  onChange,
}: {
  value: ReportGrade | null
  disabled: boolean
  onChange: (grade: ReportGrade | null) => void
}) {
  const { t } = useTranslation()
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange((e.target.value || null) as ReportGrade | null)}
      className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text disabled:bg-ppme-bg-alt"
    >
      <option value="">{t('reports.notGraded')}</option>
      {REPORT_GRADE_OPTIONS.map((grade) => (
        <option key={grade} value={grade}>
          {t(GRADE_LABEL_KEY[grade])}
        </option>
      ))}
    </select>
  )
}
