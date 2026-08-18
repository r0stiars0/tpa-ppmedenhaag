import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMyStudents } from '../../hooks/useMyStudents'
import { useViewScope } from '../../context/ViewScopeContext'
import { isSelfRecord } from '../../lib/capabilities'
import { ChildPicker } from '../../components/ChildPicker'
import { getErrorMessage } from '../../lib/errors'
import { fetchReportsForStudents, type YearEndReport } from './api'
import { ReportCard } from './ReportCard'

/**
 * FR-004 — parent and 16+ student view of published year-end reports.
 *
 * Nothing here filters on status: the `yer_parent_read` / `yer_student_read`
 * policies only ever return `status = 'published'` rows, so a draft is
 * not something this screen hides — it is something this screen can
 * never receive. Mirrors FamilyQuranView/FamilyMurajaahView's shape.
 */
export function FamilyReportsView() {
  const { t } = useTranslation()
  const { selfStudentId } = useViewScope()
  const { students, loading: studentsLoading } = useMyStudents()

  const [studentId, setStudentId] = useState<string | null>(null)
  const [reports, setReports] = useState<YearEndReport[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!studentId && students.length > 0) setStudentId(students[0].id)
  }, [students, studentId])

  useEffect(() => {
    if (!studentId) return
    let active = true
    setLoading(true)
    setError(null)
    fetchReportsForStudents([studentId])
      .then((data) => {
        if (active) setReports(data)
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
  }, [studentId])

  const selectedName = useMemo(
    () => students.find((s) => s.id === studentId)?.full_name,
    [students, studentId],
  )
  const title =
    !isSelfRecord(studentId, selfStudentId) && selectedName
      ? t('reports.childTitle', { name: selectedName })
      : t('reports.myTitle')

  if (studentsLoading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (students.length === 0) return <p className="text-ppme-text/60">{t('common.empty')}</p>

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-ppme-primary">{title}</h1>

      <ChildPicker students={students} value={studentId} onChange={setStudentId} />

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

      {loading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : reports.length === 0 ? (
        <p className="rounded-lg bg-white p-6 text-center text-ppme-text/60 shadow-sm">
          {t('reports.empty')}
        </p>
      ) : (
        reports.map((report) => <ReportCard key={report.id} report={report} />)
      )}
    </div>
  )
}
