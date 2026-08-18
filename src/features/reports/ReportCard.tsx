import { useTranslation } from 'react-i18next'
import type { ReportGrade } from '../../lib/reports'
import type { YearEndReport } from './api'
import { AttendanceSummaryCard } from './AttendanceSummaryCard'
import { DownloadPdfButton } from './DownloadPdfButton'
import { GRADE_BADGE_CLASS, GRADE_LABEL_KEY, STATUS_BADGE_CLASS, STATUS_LABEL_KEY } from './grade'

/**
 * Read-only rendering of one report — the family view (FR-004), and the
 * same content a tutor sees above the edit form. Mirrors the card-based
 * language of FamilyQuranView/FamilyMurajaahView rather than trying to
 * look like the PDF.
 */
export function ReportCard({ report }: { report: YearEndReport }) {
  const { t } = useTranslation()

  return (
    <article className="space-y-4">
      <header className="flex items-center justify-between gap-2 rounded-lg bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-ppme-text">
          {t('reports.academicYear', { year: report.academic_year })}
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE_CLASS[report.status]}`}
        >
          {t(STATUS_LABEL_KEY[report.status])}
        </span>
      </header>

      <AttendanceSummaryCard report={report} />

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-ppme-text/70">{t('reports.subjectGrades')}</h3>
        <dl className="mt-2 divide-y divide-black/5">
          <GradeRow
            label={t('reports.subjectYanbua')}
            grade={report.yanbua_grade}
            notes={report.yanbua_notes}
          />
          <GradeRow
            label={t('reports.subjectQuran')}
            grade={report.quran_grade}
            notes={report.quran_notes}
          />
          <GradeRow
            label={t('reports.subjectMurajaah')}
            grade={report.murajaah_grade}
            notes={report.murajaah_notes}
          />
          <GradeRow label={t('reports.overallGrade')} grade={report.overall_grade} notes={null} />
        </dl>
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-ppme-text/70">{t('reports.narrative')}</h3>
        <p className="mt-2 whitespace-pre-line text-sm text-ppme-text">
          {report.narrative?.trim() || '—'}
        </p>
      </section>

      {report.status === 'published' && report.pdf_path ? (
        <DownloadPdfButton reportId={report.id} />
      ) : (
        <p className="text-center text-sm text-ppme-text/60">{t('reports.noPdfYet')}</p>
      )}
    </article>
  )
}

function GradeRow({
  label,
  grade,
  notes,
}: {
  label: string
  grade: ReportGrade | null
  notes: string | null
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div>
        <dt className="text-sm font-medium text-ppme-text">{label}</dt>
        {notes?.trim() && <dd className="text-xs text-ppme-text/60">{notes}</dd>}
      </div>
      <dd>
        {grade ? (
          <span
            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${GRADE_BADGE_CLASS[grade]}`}
          >
            {t(GRADE_LABEL_KEY[grade])}
          </span>
        ) : (
          <span className="text-xs text-ppme-text/50">{t('reports.notGraded')}</span>
        )}
      </dd>
    </div>
  )
}
