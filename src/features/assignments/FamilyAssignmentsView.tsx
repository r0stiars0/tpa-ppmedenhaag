import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMyStudents } from '../../hooks/useMyStudents'
import { useViewScope } from '../../context/ViewScopeContext'
import { isSelfRecord } from '../../lib/capabilities'
import { ChildPicker } from '../../components/ChildPicker'
import { getErrorMessage } from '../../lib/errors'
import { computeDisplayStatus, type AssignmentDisplayStatus } from '../../lib/assignments'
import {
  fetchAssignmentsByIds,
  fetchMyAssignmentStatuses,
  todayLocalDate,
  type Assignment,
  type AssignmentStatusRow,
} from './api'

const STATUS_BADGE: Record<AssignmentDisplayStatus, string> = {
  pending: 'bg-ppme-bg-alt text-ppme-text/60',
  completed: 'bg-ppme-success/10 text-ppme-success',
  incomplete: 'bg-ppme-danger/10 text-ppme-danger',
  partial: 'bg-ppme-accent/15 text-ppme-primary',
  overdue: 'bg-ppme-danger text-white',
}

const STATUS_LABEL_KEY: Record<AssignmentDisplayStatus, string> = {
  pending: 'assignments.statusPending',
  completed: 'assignments.statusCompleted',
  incomplete: 'assignments.statusIncomplete',
  partial: 'assignments.statusPartial',
  overdue: 'assignments.statusOverdue',
}

interface AssignmentWithStatus {
  assignment: Assignment
  status: AssignmentStatusRow
}

export function FamilyAssignmentsView() {
  const { t, i18n } = useTranslation()
  const { selfStudentId } = useViewScope()
  const { students, loading: studentsLoading } = useMyStudents()

  const [studentId, setStudentId] = useState<string | null>(null)
  const [items, setItems] = useState<AssignmentWithStatus[]>([])
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

    async function load() {
      try {
        const statuses = await fetchMyAssignmentStatuses(studentId!)
        const assignmentIds = [...new Set(statuses.map((s) => s.assignment_id))]
        const assignments = await fetchAssignmentsByIds(assignmentIds)
        if (!active) return

        const assignmentById = new Map(assignments.map((a) => [a.id, a]))
        const combined = statuses
          .map((status) => {
            const assignment = assignmentById.get(status.assignment_id)
            return assignment ? { assignment, status } : null
          })
          .filter((row): row is AssignmentWithStatus => row !== null)
          .sort((a, b) => (a.assignment.due_date < b.assignment.due_date ? 1 : -1))

        setItems(combined)
      } catch (err) {
        if (active) setError(getErrorMessage(err))
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [studentId])

  const today = todayLocalDate()
  const displayItems = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        displayStatus: computeDisplayStatus(item.status.status, item.assignment.due_date, today),
      })),
    [items, today],
  )
  const activeCount = useMemo(
    () => displayItems.filter((i) => i.displayStatus === 'pending' || i.displayStatus === 'overdue').length,
    [displayItems],
  )

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === 'nl' ? 'nl-NL' : 'id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    [i18n.language],
  )

  const selectedName = useMemo(
    () => students.find((s) => s.id === studentId)?.full_name,
    [students, studentId],
  )
  const title =
    !isSelfRecord(studentId, selfStudentId) && selectedName
      ? t('assignments.childTitle', { name: selectedName })
      : t('assignments.myTitle')

  if (studentsLoading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (students.length === 0) return <p className="text-ppme-text/60">{t('common.empty')}</p>

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-ppme-primary">{title}</h1>

      <ChildPicker students={students} value={studentId} onChange={setStudentId} />

      {!loading && displayItems.length > 0 && (
        <p className="text-sm font-medium text-ppme-text/70">
          {t('assignments.active', { count: activeCount })}
        </p>
      )}

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

      {loading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : displayItems.length === 0 ? (
        <p className="text-ppme-text/60">{t('common.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {displayItems.map(({ assignment, status, displayStatus }) => (
            <li key={status.id} className="rounded-lg bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-ppme-text">{assignment.title}</p>
                  {assignment.description && (
                    <p className="mt-1 text-xs text-ppme-text/60">{assignment.description}</p>
                  )}
                  <p className="mt-1 text-xs text-ppme-text/60">
                    {t('assignments.fieldDueDate')}:{' '}
                    {dateFormatter.format(new Date(`${assignment.due_date}T00:00:00`))}
                  </p>
                  {status.notes && <p className="mt-1 text-xs text-ppme-text/60">{status.notes}</p>}
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGE[displayStatus]}`}
                >
                  {t(STATUS_LABEL_KEY[displayStatus])}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
