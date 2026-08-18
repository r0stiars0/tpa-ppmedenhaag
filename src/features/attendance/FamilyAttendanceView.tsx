import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMyStudents } from '../../hooks/useMyStudents'
import { useViewScope } from '../../context/ViewScopeContext'
import { isSelfRecord } from '../../lib/capabilities'
import { ChildPicker } from '../../components/ChildPicker'
import { computeAttendanceRate } from '../../lib/attendance'
import { getErrorMessage } from '../../lib/errors'
import { fetchAttendanceHistory, todayLocalDate, type AttendanceHistoryRow } from './api'

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
  const [history, setHistory] = useState<AttendanceHistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState(() => daysAgo(90))
  const [to, setTo] = useState(() => todayLocalDate())

  useEffect(() => {
    if (!studentId && students.length > 0) setStudentId(students[0].id)
  }, [students, studentId])

  useEffect(() => {
    if (!studentId) return
    let active = true
    setLoading(true)
    setError(null)
    fetchAttendanceHistory(studentId)
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

  const filtered = useMemo(
    () => history.filter((r) => r.date >= from && r.date <= to),
    [history, from, to],
  )
  const rate = useMemo(() => computeAttendanceRate(filtered.map((r) => r.status)), [filtered])

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
  const title =
    !isSelfRecord(studentId, selfStudentId) && selectedName
      ? t('attendance.childTitle', { name: selectedName })
      : t('attendance.myTitle')

  if (studentsLoading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (students.length === 0) return <p className="text-ppme-text/60">{t('common.empty')}</p>

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-ppme-primary">{title}</h1>

      <ChildPicker students={students} value={studentId} onChange={setStudentId} />

      {/*
        The date range keeps its own card. It used to share one with the
        picker above, which is why this screen never showed the empty box
        the other five did — the card had the filter to fall back on. Now
        that `ChildPicker` carries its own card, sharing would nest one
        inside the other, so the two are siblings and a single-child
        family sees exactly what it saw before: this card alone.
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

      <div className="rounded-lg bg-white p-4 text-center shadow-sm">
        <p className="text-3xl font-bold text-ppme-primary">{rate}%</p>
        <p className="mt-1 text-sm text-ppme-text/70">{t('attendance.attendanceRate')}</p>
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
