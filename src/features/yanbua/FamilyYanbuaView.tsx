import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMyStudents } from '../../hooks/useMyStudents'
import { useViewScope } from '../../context/ViewScopeContext'
import { isSelfRecord } from '../../lib/capabilities'
import { ChildPicker } from '../../components/ChildPicker'
import type { JilidRef } from '../../lib/yanbua'
import { getErrorMessage } from '../../lib/errors'
import { fetchYanbuaHistory, fetchYanbuaJilidRef, type YanbuaProgress } from './api'
import { CurrentLevelCard } from './CurrentLevelCard'
import { YanbuaTimeline } from './YanbuaTimeline'

export function FamilyYanbuaView() {
  const { t } = useTranslation()
  const { selfStudentId } = useViewScope()
  const { students, loading: studentsLoading } = useMyStudents()

  const [studentId, setStudentId] = useState<string | null>(null)
  const [history, setHistory] = useState<YanbuaProgress[]>([])
  const [jilidRefs, setJilidRefs] = useState<JilidRef[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchYanbuaJilidRef()
      .then(setJilidRefs)
      .catch((err) => setError(getErrorMessage(err)))
  }, [])

  useEffect(() => {
    if (!studentId && students.length > 0) setStudentId(students[0].id)
  }, [students, studentId])

  useEffect(() => {
    if (!studentId) return
    let active = true
    setLoading(true)
    setError(null)
    fetchYanbuaHistory(studentId)
      .then((data) => {
        if (active) setHistory(data)
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
      ? t('yanbua.childTitle', { name: selectedName })
      : t('yanbua.myTitle')

  if (studentsLoading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (students.length === 0) return <p className="text-ppme-text/60">{t('common.empty')}</p>

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-ppme-primary">{title}</h1>

      <ChildPicker students={students} value={studentId} onChange={setStudentId} />

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

      <CurrentLevelCard latest={history[0] ?? null} jilidRefs={jilidRefs} titleKey="yanbua.myCurrentLevel" />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-ppme-text/70">{t('yanbua.sessionHistory')}</h2>
        {loading ? <p className="text-ppme-text/60">{t('common.loading')}</p> : <YanbuaTimeline entries={history} />}
      </div>
    </div>
  )
}
