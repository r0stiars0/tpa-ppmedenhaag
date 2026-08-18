import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useViewScope } from '../../context/ViewScopeContext'
import { useMyClasses } from '../../hooks/useMyClasses'
import { ClassPicker } from '../../components/ClassPicker'
import type { Database, TablesInsert } from '../../lib/database.types'
import { getErrorMessage } from '../../lib/errors'
import { isNetworkError } from '../../lib/network'
import { offlineQueue } from '../../lib/offlineQueue'
import { isRecordableStudent, recordableStudents } from '../../lib/roster'
import {
  fetchAttendanceForSession,
  fetchClassRoster,
  getOrCreateTodaySession,
  submitAttendance,
  todayLocalDate,
  type RosterStudent,
} from './api'

type AttendanceStatus = Database['public']['Enums']['attendance_status']

const REASON_PRESET_KEYS = ['reasonSick', 'reasonPermission', 'reasonNoReason', 'reasonOther'] as const

interface RowState {
  status: AttendanceStatus
  reason: string
}

/**
 * The class register — and the one screen where a student assistant's
 * own row stays visible while being left out of what is submitted
 * (TAD ADR-023(c), closed by ADR-025).
 *
 * ── Why the fix is here and not in a policy ─────────────────────────
 * `submitAttendance` upserts the whole roster in a single statement, so
 * a policy refusing one row refuses the save for the entire class —
 * Aisyah could no longer mark *anybody*, which is a worse failure than
 * the hole. ADR-023 therefore left `attendance` out of
 * `fn_my_recordable_students()` deliberately and recorded the gap as
 * accepted residual risk (DPIA R7), on the stated grounds that no
 * screen routed an assistant to a register in the first place. This PR
 * is what removes that mitigation, so it is this PR's to close.
 *
 * ── Who marks the assistant present ─────────────────────────────────
 * A co-tutor, or an admin. The reason that is an answer rather than a
 * hope is ADR-014: an admin holds the class shape on *every* class
 * (`useMyClasses`'s admin branch), so there is always at least one
 * account that can complete her row even on a class with no second
 * tutor. Her row is shown rather than hidden precisely so this is
 * visible — she can see whether she was marked, and anyone else opening
 * the register sees a row still to fill.
 *
 * The exclusion is `recordableStudents`, the same predicate the five
 * other recording screens filter their rosters with, and it subtracts
 * her own record only — never a tutor-parent's children, who stay on
 * the register and are marked by their parent in the ordinary way
 * (ADR-024, and ADR-024(c) on why the two must not be collapsed).
 */
export function TutorAttendanceView() {
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const { selfStudentId } = useViewScope()
  const { classes, loading: classesLoading } = useMyClasses()

  const [classId, setClassId] = useState<string | null>(null)
  const [roster, setRoster] = useState<RosterStudent[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [queued, setQueued] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!classId && classes.length > 0) setClassId(classes[0].id)
  }, [classes, classId])

  useEffect(() => {
    if (!classId || !profile) return
    let active = true
    setLoading(true)
    setError(null)
    setSubmitted(false)
    setQueued(false)

    async function load() {
      try {
        const [rosterData, session] = await Promise.all([
          fetchClassRoster(classId!),
          getOrCreateTodaySession(classId!, profile!.id),
        ])
        if (!active) return

        const existing = await fetchAttendanceForSession(session.id)
        if (!active) return

        const existingByStudent = new Map(existing.map((a) => [a.student_id, a]))
        const initialRows: Record<string, RowState> = {}
        for (const student of rosterData) {
          const record = existingByStudent.get(student.id)
          initialRows[student.id] = {
            status: record?.status ?? 'present',
            reason: record?.reason ?? '',
          }
        }

        setRoster(rosterData)
        setSessionId(session.id)
        setRows(initialRows)
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
  }, [classId, profile])

  // The rows this register may write. Identical to `roster` for every
  // account in the TPA except a student assistant looking at the class
  // she is herself enrolled in — `selfStudentId` is null for everyone
  // else, and the predicate is a plain inequality.
  const submittable = useMemo(
    () => recordableStudents(roster, selfStudentId),
    [roster, selfStudentId],
  )

  const todayLabel = useMemo(() => {
    const date = new Date(`${todayLocalDate()}T00:00:00`)
    return new Intl.DateTimeFormat(i18n.language === 'nl' ? 'nl-NL' : 'id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(date)
  }, [i18n.language])

  function setStatus(studentId: string, status: AttendanceStatus) {
    setSubmitted(false)
    setQueued(false)
    setRows((prev) => ({
      ...prev,
      [studentId]: { status, reason: status === 'absent' ? prev[studentId]?.reason ?? '' : '' },
    }))
  }

  function setReason(studentId: string, reason: string) {
    setSubmitted(false)
    setQueued(false)
    setRows((prev) => ({ ...prev, [studentId]: { ...prev[studentId], reason } }))
  }

  async function handleSubmit() {
    if (!sessionId) return
    setSubmitting(true)
    setError(null)
    setQueued(false)
    const payload: TablesInsert<'attendance'>[] = submittable.map((student) => ({
      session_id: sessionId,
      student_id: student.id,
      status: rows[student.id]?.status ?? 'present',
      reason: rows[student.id]?.status === 'absent' ? rows[student.id]?.reason || null : null,
    }))
    try {
      await submitAttendance(payload)
      setSubmitted(true)
      setConfirming(false)
    } catch (err) {
      // A network failure means the register never left the device —
      // upsert on (session_id, student_id) makes it safe to queue and
      // replay whole, unlike a real rejection (a validation error, an
      // RLS denial), which must reach the tutor now rather than sit in
      // a queue pretending to have been handled.
      if (isNetworkError(err)) {
        await offlineQueue.enqueue('attendance', payload)
        setQueued(true)
        setConfirming(false)
      } else {
        setError(getErrorMessage(err))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (classesLoading) {
    return <p className="text-ppme-text/60">{t('common.loading')}</p>
  }

  if (classes.length === 0) {
    return <p className="text-ppme-text/60">{t('common.noClassesAssigned')}</p>
  }

  return (
    <div className="space-y-4">
      {/*
        The heading lives here rather than in `AttendancePage` because
        the family view's has to name the child on screen, which the page
        cannot know. The class side has no such problem, so it is simply
        the screen's name.
      */}
      <h1 className="text-lg font-bold text-ppme-primary">{t('attendance.title')}</h1>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <ClassPicker classes={classes} value={classId} onChange={setClassId} />
        <p className="mt-2 text-sm font-medium capitalize text-ppme-text/70">{todayLabel}</p>
      </div>

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

      {loading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : roster.length === 0 ? (
        <p className="text-ppme-text/60">{t('common.noStudentsInClass')}</p>
      ) : (
        <div className="space-y-2">
          {roster.map((student) => {
            const row = rows[student.id] ?? { status: 'present', reason: '' }

            // The assistant's own row: shown, so she can see whether
            // somebody has marked her and so the next tutor to open the
            // register sees it waiting, but not hers to set. The status
            // rendered is whatever is already stored for her today,
            // which is `present` before anyone has recorded anything —
            // the same default every other row starts from, and the
            // reason the caption says who fills it in rather than
            // letting the chip read as a claim.
            if (!isRecordableStudent(student.id, selfStudentId)) {
              return (
                <div key={student.id} className="rounded-lg bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-ppme-text">{student.full_name}</span>
                    <span className="rounded-md bg-ppme-bg-alt px-3 py-2 text-xs font-semibold text-ppme-text/60">
                      {t(`attendance.${row.status}`)}
                    </span>
                  </div>
                  <p className="mt-2 border-t border-black/5 pt-2 text-xs text-ppme-text/60">
                    {t('attendance.ownRowNotEditable')}
                  </p>
                </div>
              )
            }

            return (
              <div key={student.id} className="rounded-lg bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-ppme-text">{student.full_name}</span>
                  <div className="flex gap-1">
                    <StatusButton
                      active={row.status === 'present'}
                      color="success"
                      label={t('attendance.present')}
                      onClick={() => setStatus(student.id, 'present')}
                    />
                    <StatusButton
                      active={row.status === 'late'}
                      color="neutral"
                      label={t('attendance.late')}
                      onClick={() => setStatus(student.id, 'late')}
                    />
                    <StatusButton
                      active={row.status === 'absent'}
                      color="danger"
                      label={t('attendance.absent')}
                      onClick={() => setStatus(student.id, 'absent')}
                    />
                  </div>
                </div>

                {row.status === 'absent' && (
                  <div className="mt-3 space-y-2 border-t border-black/5 pt-3">
                    <div className="flex flex-wrap gap-1.5">
                      {REASON_PRESET_KEYS.map((key) => (
                        <button
                          key={key}
                          type="button"
                          className="min-h-11 rounded-full border border-black/10 px-3 text-xs font-medium text-ppme-text/70 hover:bg-ppme-bg-alt"
                          onClick={() =>
                            setReason(student.id, key === 'reasonOther' ? '' : t(`attendance.${key}`))
                          }
                        >
                          {t(`attendance.${key}`)}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      className="min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
                      placeholder={t('attendance.reason')}
                      value={row.reason}
                      onChange={(e) => setReason(student.id, e.target.value)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {submittable.length > 0 && !loading && (
        <div className="space-y-2">
          {submitted && (
            <p className="rounded-lg bg-ppme-success/10 p-3 text-sm text-ppme-success">
              {t('attendance.submitted')}
            </p>
          )}
          {queued && (
            <p className="rounded-lg bg-ppme-primary/10 p-3 text-sm text-ppme-primary">
              {t('common.offline')}
            </p>
          )}
          {confirming ? (
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <p className="text-sm text-ppme-text">
                {/* The number actually being written, which is the
                    roster minus the assistant's own row — a confirm
                    dialog that overstates by one is how somebody learns
                    they were counted when they were not. */}
                {t('attendance.confirmSubmit', { count: submittable.length })}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleSubmit()}
                  className="min-h-11 flex-1 rounded-lg bg-ppme-primary px-4 font-semibold text-white disabled:opacity-60"
                >
                  {submitting ? t('common.loading') : t('common.confirm')}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setConfirming(false)}
                  className="min-h-11 flex-1 rounded-lg border border-black/10 px-4 font-semibold text-ppme-text"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="min-h-11 w-full rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark"
            >
              {t('attendance.submit')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function StatusButton({
  active,
  color,
  label,
  onClick,
}: {
  active: boolean
  color: 'success' | 'danger' | 'neutral'
  label: string
  onClick: () => void
}) {
  const activeClasses =
    color === 'success'
      ? 'bg-ppme-success text-white'
      : color === 'danger'
        ? 'bg-ppme-danger text-white'
        : 'bg-ppme-text text-white'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 rounded-md px-3 text-xs font-semibold transition-colors ${
        active ? activeClasses : 'bg-ppme-bg-alt text-ppme-text/60 hover:bg-black/5'
      }`}
    >
      {label}
    </button>
  )
}
