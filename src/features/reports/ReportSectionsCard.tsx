import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getErrorMessage } from '../../lib/errors'
import { fetchGroupTutorNames } from '../groups/api'
import type { ReportSection } from './api'
import { GRADE_LABEL_KEY } from './grade'
import { SectionForm, isSectionComplete } from './SectionForm'

/**
 * "Bagian dari grup lain" in the report editor (PRD Feature 8 FR-008,
 * Resolved Decision 34): each group section with its status and tutor.
 * A section opens for editing only for a tutor of that group while the
 * report is a draft, or for an admin; the report's author reads the
 * others and cannot change them.
 */
export function ReportSectionsCard({
  sections,
  canEditSection,
  onChanged,
}: {
  sections: ReportSection[]
  canEditSection: (section: ReportSection) => boolean
  onChanged: (id: string, value: { grade: ReportSection['grade']; narrative: string | null }) => void
}) {
  const { t } = useTranslation()
  const [tutors, setTutors] = useState<Map<string, string[]>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const classKey = sections.map((s) => s.class_id).join(',')

  useEffect(() => {
    let active = true
    const ids = classKey ? classKey.split(',') : []
    Promise.all(ids.map(async (id) => [id, await fetchGroupTutorNames(id)] as const))
      .then((pairs) => active && setTutors(new Map(pairs)))
      .catch((err) => active && setError(getErrorMessage(err)))
    return () => {
      active = false
    }
  }, [classKey])

  if (sections.length === 0) return null
  return (
    <section className="space-y-3 rounded-lg bg-white p-4 shadow-sm" aria-labelledby="report-sections-heading">
      <h3 id="report-sections-heading" className="text-sm font-semibold text-ppme-text/70">
        {t('reports.otherGroupSections')}
      </h3>
      {error && <p className="text-sm text-ppme-danger">{error}</p>}
      {sections.map((section) => {
        const complete = isSectionComplete(section)
        const editable = canEditSection(section)
        const names = tutors.get(section.class_id)
        return (
          <div key={section.id} className="space-y-2 rounded-lg border border-black/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ppme-text">{section.class?.name ?? '—'}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  complete ? 'bg-ppme-primary/10 text-ppme-primary' : 'bg-ppme-bg-alt text-ppme-text/70'
                }`}
              >
                {complete ? t('reports.sectionFilled') : t('reports.sectionEmpty')}
              </span>
            </div>
            {names && names.length > 0 && <p className="text-xs text-ppme-text/60">{t('groups.tutors', { names: names.join(', ') })}</p>}
            {editable ? (
              <SectionForm section={section} editable onSaved={(value) => onChanged(section.id, value)} />
            ) : (
              <>
                {complete && (
                  <p className="text-sm text-ppme-text">
                    <span className="font-semibold">{section.grade ? t(GRADE_LABEL_KEY[section.grade]) : ''}</span>
                    {' · '}
                    {section.narrative}
                  </p>
                )}
                <p className="text-xs text-ppme-text/60">{t('reports.sectionOwnGroupOnly')}</p>
              </>
            )}
          </div>
        )
      })}
    </section>
  )
}
