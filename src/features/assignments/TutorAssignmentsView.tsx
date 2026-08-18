import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useMyClasses } from '../../hooks/useMyClasses'
import { ClassPicker } from '../../components/ClassPicker'
import { fetchRecordableRoster, type RosterStudent } from '../../lib/roster'
import { useViewScope } from '../../context/ViewScopeContext'
import type { Database, TablesInsert } from '../../lib/database.types'
import { getErrorMessage } from '../../lib/errors'
import {
  createAssignment,
  createAssignmentStatuses,
  fetchAssignmentStatuses,
  fetchClassAssignments,
  todayLocalDate,
  updateAssignmentStatus,
  type Assignment,
  type AssignmentStatusRow,
} from './api'

type AssignmentStatusEnum = Database['public']['Enums']['assignment_status_enum']

const STATUS_OPTIONS: { value: AssignmentStatusEnum; labelKey: string }[] = [
  { value: 'pending', labelKey: 'assignments.statusPending' },
  { value: 'completed', labelKey: 'assignments.statusCompleted' },
  { value: 'incomplete', labelKey: 'assignments.statusIncomplete' },
  { value: 'partial', labelKey: 'assignments.statusPartial' },
]

const STATUS_COLOR: Record<AssignmentStatusEnum, string> = {
  pending: 'bg-ppme-bg-alt text-ppme-text/60',
  completed: 'bg-ppme-success text-white',
  incomplete: 'bg-ppme-danger text-white',
  partial: 'bg-ppme-accent/80 text-white',
}

interface RowState {
  id: string
  studentId: string
  status: AssignmentStatusEnum
  notes: string
}

export function TutorAssignmentsView() {
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const { classes, loading: classesLoading } = useMyClasses()
  const { selfStudentId } = useViewScope()

  const [classId, setClassId] = useState<string | null>(null)
  const [roster, setRoster] = useState<RosterStudent[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState(() => todayLocalDate())
  const [recipients, setRecipients] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [createdBanner, setCreatedBanner] = useState<string | null>(null)

  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null)
  const [rows, setRows] = useState<RowState[]>([])
  const [rowsLoading, setRowsLoading] = useState(false)
  const [savingRowId, setSavingRowId] = useState<string | null>(null)

  useEffect(() => {
    if (!classId && classes.length > 0) setClassId(classes[0].id)
  }, [classes, classId])

  useEffect(() => {
    if (!classId) return
    let active = true
    setLoading(true)
    setError(null)
    setSelectedAssignment(null)
    Promise.all([fetchRecordableRoster(classId, selfStudentId), fetchClassAssignments(classId)])
      .then(([rosterData, assignmentsData]) => {
        if (!active) return
        setRoster(rosterData)
        setAssignments(assignmentsData)
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
  }, [classId, selfStudentId])

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === 'nl' ? 'nl-NL' : 'id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    [i18n.language],
  )

  function openCreateForm() {
    setTitle('')
    setDescription('')
    setDueDate(todayLocalDate())
    setRecipients(new Set(roster.map((s) => s.id)))
    setCreatedBanner(null)
    setError(null)
    setShowCreate(true)
  }

  function toggleRecipient(studentId: string) {
    setRecipients((prev) => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  async function handleCreate() {
    if (!classId || !profile || !title.trim() || !dueDate || recipients.size === 0) return
    setCreating(true)
    setError(null)
    try {
      const created = await createAssignment({
        class_id: classId,
        tutor_id: profile.id,
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate,
      })
      const statusRows: TablesInsert<'assignment_status'>[] = [...recipients].map((studentId) => ({
        assignment_id: created.id,
        student_id: studentId,
      }))
      await createAssignmentStatuses(statusRows)

      setAssignments((prev) => [created, ...prev])
      setCreatedBanner(
        t('assignments.created', { title: created.title, date: dateFormatter.format(new Date(`${created.due_date}T00:00:00`)) }),
      )
      setShowCreate(false)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  function openAssignment(assignment: Assignment) {
    setSelectedAssignment(assignment)
    setError(null)
    setRowsLoading(true)
    fetchAssignmentStatuses(assignment.id)
      .then((data: AssignmentStatusRow[]) => {
        setRows(
          data.map((r) => ({ id: r.id, studentId: r.student_id, status: r.status, notes: r.notes ?? '' })),
        )
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setRowsLoading(false))
  }

  async function saveRow(rowId: string, patch: Partial<Pick<RowState, 'status' | 'notes'>>) {
    const current = rows.find((r) => r.id === rowId)
    if (!current) return
    const next = { ...current, ...patch }
    setRows((prev) => prev.map((r) => (r.id === rowId ? next : r)))
    setSavingRowId(rowId)
    setError(null)
    try {
      await updateAssignmentStatus(rowId, { status: next.status, notes: next.notes || null })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSavingRowId(null)
    }
  }

  const rosterById = useMemo(() => new Map(roster.map((s) => [s.id, s.full_name])), [roster])
  const today = todayLocalDate()

  if (classesLoading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (classes.length === 0) return <p className="text-ppme-text/60">{t('common.noClassesAssigned')}</p>

  if (selectedAssignment) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setSelectedAssignment(null)}
          className="min-h-11 text-sm font-medium text-ppme-primary"
        >
          ← {t('common.back')}
        </button>

        <div className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-ppme-text">{selectedAssignment.title}</h2>
          {selectedAssignment.description && (
            <p className="mt-1 text-sm text-ppme-text/70">{selectedAssignment.description}</p>
          )}
          <p className="mt-2 text-xs font-medium text-ppme-text/60">
            {t('assignments.fieldDueDate')}:{' '}
            {dateFormatter.format(new Date(`${selectedAssignment.due_date}T00:00:00`))}
          </p>
        </div>

        {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

        {rowsLoading ? (
          <p className="text-ppme-text/60">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-ppme-text/60">{t('common.empty')}</p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="rounded-lg bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-ppme-text">
                    {rosterById.get(row.studentId) ?? row.studentId}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={savingRowId === row.id}
                      onClick={() => void saveRow(row.id, { status: opt.value })}
                      className={`min-h-11 rounded-md px-3 text-xs font-semibold transition-colors disabled:opacity-60 ${
                        row.status === opt.value ? STATUS_COLOR[opt.value] : 'bg-ppme-bg-alt text-ppme-text/60 hover:bg-black/5'
                      }`}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
                <textarea
                  value={row.notes}
                  onChange={(e) =>
                    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, notes: e.target.value } : r)))
                  }
                  onBlur={() => void saveRow(row.id, { notes: row.notes })}
                  rows={2}
                  placeholder={t('assignments.notes')}
                  className="mt-3 w-full rounded-lg border border-black/10 px-2 py-1.5 text-sm text-ppme-text"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-ppme-primary">{t('assignments.title')}</h1>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <ClassPicker classes={classes} value={classId} onChange={setClassId} />
      </div>

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}
      {createdBanner && (
        <p className="rounded-lg bg-ppme-success/10 p-3 text-sm text-ppme-success">{createdBanner}</p>
      )}

      {showCreate ? (
        <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-ppme-text">{t('assignments.newTitle')}</h2>

          <label className="block text-xs font-medium text-ppme-text/70">
            {t('assignments.fieldTitle')}
            <input
              type="text"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
            />
          </label>

          <label className="block text-xs font-medium text-ppme-text/70">
            {t('assignments.fieldDescription')}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5 text-sm text-ppme-text"
            />
          </label>

          <label className="block text-xs font-medium text-ppme-text/70">
            {t('assignments.fieldDueDate')}
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
            />
          </label>

          <div>
            <p className="text-xs font-medium text-ppme-text/70">{t('common.selectStudent')}</p>
            <div className="mt-1 space-y-1">
              {roster.map((student) => (
                <label
                  key={student.id}
                  className="flex min-h-11 items-center gap-2 rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
                >
                  <input
                    type="checkbox"
                    checked={recipients.has(student.id)}
                    onChange={() => toggleRecipient(student.id)}
                    className="h-4 w-4"
                  />
                  {student.full_name}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={creating || !title.trim() || !dueDate || recipients.size === 0}
              onClick={() => void handleCreate()}
              className="min-h-11 flex-1 rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
            >
              {creating ? t('common.loading') : t('common.save')}
            </button>
            <button
              type="button"
              disabled={creating}
              onClick={() => setShowCreate(false)}
              className="min-h-11 flex-1 rounded-lg border border-black/10 px-4 font-semibold text-ppme-text"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openCreateForm}
          disabled={loading}
          className="min-h-11 w-full rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
        >
          {t('assignments.new')}
        </button>
      )}

      {loading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : assignments.length === 0 ? (
        <p className="text-ppme-text/60">{t('common.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {assignments.map((assignment) => (
            <li key={assignment.id}>
              <button
                type="button"
                onClick={() => openAssignment(assignment)}
                className="min-h-11 w-full rounded-lg bg-white p-4 text-left shadow-sm hover:bg-ppme-bg-alt"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-ppme-text">{assignment.title}</span>
                  {assignment.due_date < today && (
                    <span className="rounded-full bg-ppme-danger/10 px-2 py-0.5 text-xs font-semibold text-ppme-danger">
                      {t('assignments.statusOverdue')}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-ppme-text/60">
                  {t('assignments.fieldDueDate')}: {dateFormatter.format(new Date(`${assignment.due_date}T00:00:00`))}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
