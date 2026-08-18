import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { currentAcademicYear, isValidAcademicYear } from '../../lib/reports'
import { getErrorMessage } from '../../lib/errors'
import type { ClassOption } from '../../hooks/useMyClasses'
import { generateDrafts, type GenerateDraftsResult } from './api'

interface GenerateDraftsPanelProps {
  classes: ClassOption[]
  /** Called after a run that created at least one draft, so the list around this panel can refresh. */
  onGenerated: () => void
}

/**
 * FR-001's bulk draft-generation trigger, admin-only.
 *
 * This used to be a screen of its own (`/admin/reports`,
 * `ReportsAdminPage`) that showed counts and nothing else, because
 * ADR-013 kept admin away from what the reports actually said. ADR-014
 * removed that separation — admin now reads and edits reports like any
 * other operational data — so a deliberately content-blind screen had
 * nothing left to protect and folded into the admin's own Reports view
 * as this panel, directly above the list it populates.
 *
 * The Function itself is unchanged and still enforces admin-only in
 * code; this panel is only ever rendered for admin.
 */
export function GenerateDraftsPanel({ classes, onGenerated }: GenerateDraftsPanelProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [academicYear, setAcademicYear] = useState(currentAcademicYear())
  const [classId, setClassId] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<GenerateDraftsResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate() {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const next = await generateDrafts({ academic_year: academicYear, class_id: classId || null })
      setResult(next)
      if (next.created_count > 0) onGenerated()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setRunning(false)
    }
  }

  const yearValid = isValidAcademicYear(academicYear)

  return (
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-2 text-left font-semibold text-ppme-primary"
      >
        {t('reports.generateDrafts')}
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-black/5 pt-3">
          {error && (
            <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>
          )}

          <label className="block text-sm font-medium text-ppme-text">
            {t('reports.academicYearLabel')}
            <input
              type="text"
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              placeholder="2025/2026"
              inputMode="numeric"
              className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-ppme-text"
            />
          </label>
          {!yearValid && (
            <p className="text-xs text-ppme-danger">{t('reports.academicYearInvalid')}</p>
          )}

          <label className="block text-sm font-medium text-ppme-text">
            {t('reports.classScope')}
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-black/10 bg-white px-3 text-ppme-text"
            >
              <option value="">{t('reports.allClasses')}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={running || !yearValid}
            className="min-h-11 w-full rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
          >
            {running ? t('common.loading') : t('reports.generateDraftsFor', { year: academicYear })}
          </button>

          {result && (
            <div className="space-y-1 rounded-lg bg-ppme-bg-alt p-3">
              <p className="font-semibold text-ppme-success">
                {t('reports.generatedCount', { count: result.created_count })}
              </p>
              <p className="text-sm text-ppme-text/70">
                {t('reports.skippedExisting', { count: result.skipped_existing })}
              </p>
              {result.skipped_no_tutor > 0 && (
                <p className="text-sm text-ppme-danger">
                  {t('reports.skippedNoTutor', { count: result.skipped_no_tutor })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
