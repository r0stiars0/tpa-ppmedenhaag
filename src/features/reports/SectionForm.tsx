import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { REPORT_GRADE_OPTIONS, type ReportGrade } from '../../lib/reports'
import { getErrorMessage } from '../../lib/errors'
import { updateSection } from './api'
import { GRADE_LABEL_KEY } from './grade'

const NARRATIVE_MAX = 2000

export interface SectionFormValue {
  id: string
  grade: ReportGrade | null
  narrative: string | null
  attendance_present: number
  attendance_absent: number
  attendance_late: number
  attendance_rate: number
}

/**
 * One group section of a year-end report (PRD Feature 8 FR-008): that
 * group's attendance, and a grade and narrative its tutor writes. Editable
 * only by a tutor of the group while the report is a draft, or by an
 * admin; everyone else sees it read-only (RLS enforces the same).
 */
export function SectionForm({
  section,
  editable,
  onSaved,
}: {
  section: SectionFormValue
  editable: boolean
  onSaved?: (value: { grade: ReportGrade | null; narrative: string | null }) => void
}) {
  const { t } = useTranslation()
  const [grade, setGrade] = useState<ReportGrade | null>(section.grade)
  const [narrative, setNarrative] = useState(section.narrative ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await updateSection(section.id, { grade, narrative })
      setMessage(t('reports.saved'))
      onSaved?.({ grade, narrative: narrative.trim() ? narrative : null })
    } catch (err) {
      const msg = getErrorMessage(err)
      setError(msg === 'locked' ? t('reports.sectionLocked') : msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-ppme-text/70">{t('reports.sectionAttendance')}</p>
      <div className="grid grid-cols-4 gap-2 text-center">
        {[
          [t('attendance.present'), section.attendance_present],
          [t('attendance.late'), section.attendance_late],
          [t('attendance.notPresent'), section.attendance_absent],
          ['%', `${Math.round(section.attendance_rate)}%`],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg bg-ppme-bg-alt px-1 py-2">
            <p className="text-xs text-ppme-text/60">{label}</p>
            <p className="font-semibold text-ppme-text">{value}</p>
          </div>
        ))}
      </div>
      <label className="block text-xs font-medium text-ppme-text/70">
        {t('reports.sectionGrade')}
        <select
          value={grade ?? ''}
          disabled={!editable || saving}
          onChange={(e) => setGrade((e.target.value || null) as ReportGrade | null)}
          className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text disabled:bg-ppme-bg-alt"
        >
          <option value="">{t('reports.notGraded')}</option>
          {REPORT_GRADE_OPTIONS.map((g) => (
            <option key={g} value={g}>
              {t(GRADE_LABEL_KEY[g])}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium text-ppme-text/70">
        {t('reports.narrative')}
        <textarea
          value={narrative}
          maxLength={NARRATIVE_MAX}
          rows={4}
          disabled={!editable || saving}
          onChange={(e) => setNarrative(e.target.value)}
          placeholder={t('reports.narrativePlaceholder')}
          className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5 text-sm text-ppme-text disabled:bg-ppme-bg-alt"
        />
      </label>
      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}
      {message && <p className="rounded-lg bg-ppme-success/10 p-3 text-sm font-medium text-ppme-success">{message}</p>}
      {editable && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="min-h-11 w-full rounded-lg bg-ppme-primary px-4 font-semibold text-white disabled:opacity-60"
        >
          {saving ? t('common.loading') : t('common.save')}
        </button>
      )}
    </div>
  )
}

/** Both a grade and a narrative (the publish rule, `reportSections.ts`). */
export function isSectionComplete(section: { grade: ReportGrade | null; narrative: string | null }): boolean {
  return section.grade !== null && (section.narrative ?? '').trim().length > 0
}
