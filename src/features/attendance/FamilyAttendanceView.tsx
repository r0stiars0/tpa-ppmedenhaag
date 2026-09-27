import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMyStudents } from '../../hooks/useMyStudents'
import { useViewScope } from '../../context/ViewScopeContext'
import { isSelfRecord } from '../../lib/capabilities'
import { ratesByGroup } from '../../lib/attendance'
import { getErrorMessage } from '../../lib/errors'
import { formatDayList } from '../../lib/weekdays'
import { AttendanceLegend } from './AttendanceMark'
import { AttendanceStrip, ChildrenAttendanceCard } from './FamilyAttendanceStrip'
import {
  fetchAttendanceHistory,
  fetchStudentGroups,
  todayLocalDate,
  type AttendanceHistoryRow,
  type StudentGroupOption,
} from './api'

function daysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const STATUS_BADGE: Record<AttendanceHistoryRow['status'], string> = {
  present: 'bg-ppme-success/10 text-ppme-success',
  late: 'bg-ppme-text/10 text-ppme-text/70',
  absent: 'bg-ppme-danger/10 text-ppme-danger',
}

export function FamilyAttendanceView() {
  const { t, i18n } = useTranslation()
  const { students, loading: studentsLoading } = useMyStudents()
  const { selfStudentId } = useViewScope()

  const [studentId, setStudentId] = useState<string | null>(null)
  const [histories, setHistories] = useState<Record<string, AttendanceHistoryRow[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState(() => daysAgo(90))
  const [to, setTo] = useState(() => todayLocalDate())
  const [groupsByStudent, setGroupsByStudent] = useState<Record<string, StudentGroupOption[]>>({})

  useEffect(() => {
    if (!studentId && students.length > 0) setStudentId(students[0].id)
  }, [students, studentId])

  // Every child at once, not only the selected one: the card at the top
  // shows them all side by side (TAD ADR-046(b)). A family has a handful
  // of children, so this is a handful of the same calls the screen made
  // one at a time before.
  useEffect(() => {
    if (students.length === 0) return
    let active = true
    Promise.all(
      students.map((s) =>
        fetchStudentGroups(s.id).catch(
          // A non-fatal extra: the history below is the screen's job.
          () => [] as StudentGroupOption[],
        ),
      ),
    ).then((lists) => {
      if (active) setGroupsByStudent(Object.fromEntries(students.map((s, i) => [s.id, lists[i]])))
    })
    return () => {
      active = false
    }
  }, [students])

  useEffect(() => {
    if (students.length === 0) return
    let active = true
    setLoading(true)
    setError(null)
    Promise.all(students.map((s) => fetchAttendanceHistory(s.id)))
      .then((lists) => {
        if (active) setHistories(Object.fromEntries(students.map((s, i) => [s.id, lists[i]])))
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
  }, [students])

  const inRange = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(histories).map(([id, rows]) => [id, rows.filter((r) => r.date >= from && r.date <= to)]),
      ),
    [histories, from, to],
  )
  const filtered = useMemo(() => (studentId ? inRange[studentId] ?? [] : []), [inRange, studentId])
  const groups = useMemo(() => (studentId ? groupsByStudent[studentId] ?? [] : []), [groupsByStudent, studentId])
  // One rate per group as well as the overall (PRD Feature 8 FR-003): a
  // single combined figure hides a child who attends one group and skips
  // the other.
  const rates = useMemo(() => ratesByGroup(filtered), [filtered])
  const showGroups = rates.groups.length > 1 || groups.length > 1

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

  /**
   * "Ali's attendance" for a parent, "my attendance" for the 16+ santri
   * looking at their own record.
   *
   * The question is about the *student on screen*, not about the
   * account: `AttendancePage` used to answer it once for the whole
   * family scope and always said "mine", so Ibu Siti read "Kehadiranku"
   * above Ali's record. `isSelfRecord` is the same per-student predicate
   * the other five family views use (ADR-025(c)) and is correct for the
   * account that is both a parent and a santri — their own row is
   * theirs, their children's are not.
   */
  const selfOnly = students.length === 1 && isSelfRecord(students[0].id, selfStudentId)

  const title =
    !isSelfRecord(studentId, selfStudentId) && selectedName
      ? t('attendance.childTitle', { name: selectedName })
      : t('attendance.myTitle')

  if (studentsLoading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (students.length === 0) return <p className="text-ppme-text/60">{t('common.empty')}</p>

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-ppme-primary">{title}</h1>

      {/*
        The date range sits above the children card because that card
        follows it: each child's marks and rate are for this range, so the
        rate in a child's row is the same number as the rate card below.
      */}
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-ppme-text/70">
            {t('common.from')}
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
            />
          </label>
          <label className="text-xs font-medium text-ppme-text/70">
            {t('common.to')}
            <input
              type="date"
              value={to}
              min={from}
              max={todayLocalDate()}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
            />
          </label>
        </div>
      </div>

      {/*
        Every child in one card, replacing the child picker (ADR-046(b)).
        A 16+ santri alone on this screen has nothing to pick between, so
        their own strip goes inside the rate card below instead.
      */}
      {!selfOnly && !loading && (
        <ChildrenAttendanceCard
          students={students.map((s) => ({
            id: s.id,
            name: s.full_name,
            groups: (groupsByStudent[s.id] ?? []).map((g) => g.name),
            rows: inRange[s.id] ?? [],
          }))}
          selectedId={studentId}
          onSelect={setStudentId}
        />
      )}

      <div className="rounded-lg bg-white p-4 text-center shadow-sm">
        {!selfOnly && selectedName && (
          <p className="mb-1 text-xs font-semibold text-ppme-text/70">{selectedName}</p>
        )}
        <p className="text-3xl font-bold text-ppme-primary">{rates.overall}%</p>
        <p className="mt-1 text-sm text-ppme-text/70">
          {showGroups ? t('attendance.overallRate') : t('attendance.attendanceRate')}
        </p>
        {showGroups && rates.groups.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-black/5 pt-3 text-left">
            {rates.groups.map((group) => (
              <li key={group.classId} className="flex items-center justify-between text-sm">
                <span className="text-ppme-text/80">{group.className}</span>
                <span className="font-semibold text-ppme-primary">{group.rate}%</span>
              </li>
            ))}
          </ul>
        )}
        {groups.map((group) =>
          group.meeting_days.length > 0 ? (
            <p key={group.id} className="mt-2 text-xs text-ppme-text/60">
              {showGroups
                ? t('attendance.meetingDaysOfGroup', { group: group.name, days: formatDayList(group.meeting_days, t) })
                : `${t('attendance.meetingDaysLabel')}: ${formatDayList(group.meeting_days, t)}`}
            </p>
          ) : null,
        )}
        {selfOnly && !loading && (
          <div className="mt-3 space-y-2 border-t border-black/5 pt-3 text-left">
            <p className="text-xs font-semibold text-ppme-text/70">{t('attendance.lastSessions', { count: 8 })}</p>
            <AttendanceStrip rows={filtered} size={16} />
            <AttendanceLegend tone="student" marks={['present', 'late', 'absent']} />
            <p className="text-xs text-ppme-text/60">{t('attendance.newestRight')}</p>
          </div>
        )}
      </div>

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-ppme-text/70">{t('attendance.history')}</h2>
        {loading ? (
          <p className="text-ppme-text/60">{t('common.loading')}</p>
        ) : filtered.length === 0 ? (
          <p className="text-ppme-text/60">{t('common.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between rounded-lg bg-white p-3 shadow-sm"
              >
                <div>
                  <p className="text-sm font-medium text-ppme-text">
                    {dateFormatter.format(new Date(`${row.date}T00:00:00`))}
                  </p>
                  {showGroups && <p className="text-xs text-ppme-text/60">{row.className}</p>}
                  {row.status === 'absent' && row.reason && (
                    <p className="text-xs text-ppme-text/60">{row.reason}</p>
                  )}
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_BADGE[row.status]}`}
                >
                  {row.status === 'absent'
                    ? t('attendance.notPresent')
                    : t(`attendance.${row.status}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
