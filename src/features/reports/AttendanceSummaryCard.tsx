import { useTranslation } from 'react-i18next'
import type { YearEndReport } from './api'

/**
 * The stats half of a report — a snapshot taken when the draft was
 * generated, not a live query, so it stays the number the tutor reviewed
 * and the family was shown even if attendance is corrected afterwards.
 */
export function AttendanceSummaryCard({ report }: { report: YearEndReport }) {
  const { t } = useTranslation()
  const rate = Number(report.attendance_rate)

  return (
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-ppme-text/70">{t('reports.attendanceSummary')}</h3>
      <p className="mt-2 text-3xl font-bold text-ppme-primary">
        {Number.isInteger(rate) ? rate : rate.toFixed(1)}%
      </p>
      <p className="text-xs text-ppme-text/60">{t('attendance.attendanceRate')}</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label={t('attendance.present')} value={report.attendance_present} />
        <Stat label={t('attendance.late')} value={report.attendance_late} />
        <Stat label={t('attendance.notPresent')} value={report.attendance_absent} />
      </dl>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-ppme-bg-alt p-2">
      <dt className="text-xs text-ppme-text/60">{label}</dt>
      <dd className="text-lg font-semibold text-ppme-text">{value}</dd>
    </div>
  )
}
