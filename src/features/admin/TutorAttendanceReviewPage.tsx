import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminSectionNav } from '../../components/AdminSectionNav'
import { computeAttendanceRate } from '../../lib/attendance'
import { getErrorMessage } from '../../lib/errors'
import { academicYearWindow, currentAcademicYear } from '../../lib/reports'
import {
  fetchReviewableTutors,
  fetchTutorAttendanceHistory,
  todayLocalDate,
  type ClassTutor,
  type TutorAttendanceHistoryRow,
} from '../attendance/api'

const STATUS_BADGE: Record<TutorAttendanceHistoryRow['status'], string> = {
  present: 'bg-ppme-success/10 text-ppme-success',
  late: 'bg-ppme-text/10 text-ppme-text/70',
  absent: 'bg-ppme-danger/10 text-ppme-danger',
}

/**
 * `/admin/tutor-attendance` — the TPA head reviews one tutor's turnout
 * over a date range (TAD ADR-041, part 2). Admin-only (`RequireAdmin`
 * on the route). The shape mirrors `FamilyAttendanceView`: a picker, a
 * date range, a rate card, then a dated list — here across every group
 * the tutor teaches, with an optional group filter.
 *
 * It reads only `tutor_attendance` (admin grant, RLS-85) and `users` /
 * `classes` (admin grant), so it adds no policy. The tutor picker is
 * everyone with at least one recorded row (`fetchReviewableTutors`), not
 * a raw `tutor_ids` list — a group's student-assistant, already left off
 * `fn_class_tutors`, has no rows here and so never appears.
 */
export function TutorAttendanceReviewPage() {
  const { t, i18n } = useTranslation()

  const [tutors, setTutors] = useState<ClassTutor[]>([])
  const [tutorsLoading, setTutorsLoading] = useState(true)
  const [tutorId, setTutorId] = useState<string | null>(null)
  const [history, setHistory] = useState<TutorAttendanceHistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState(() => academicYearWindow(currentAcademicYear()).start)
  const [to, setTo] = useState(() => todayLocalDate())
  const [classFilter, setClassFilter] = useState<string>('')

  useEffect(() => {
    let active = true
    fetchReviewableTutors()
      .then((rows) => {
        if (!active) return
        setTutors(rows)
        setTutorId((id) => id ?? rows[0]?.user_id ?? null)
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err))
      })
      .finally(() => {
        if (active) setTutorsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!tutorId) return
    let active = true
    setLoading(true)
    setError(null)
    setClassFilter('')
    fetchTutorAttendanceHistory(tutorId)
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
  }, [tutorId])

  const classNames = useMemo(
    () => [...new Set(history.map((r) => r.className).filter(Boolean))].sort(),
    [history],
  )

  const filtered = useMemo(
    () =>
      history.filter(
        (r) =>
          r.date >= from &&
          r.date <= to &&
          (classFilter === '' || r.className === classFilter),
      ),
    [history, from, to, classFilter],
  )

  const rate = useMemo(() => computeAttendanceRate(filtered.map((r) => r.status)), [filtered])
  const counts = useMemo(
    () => ({
      present: filtered.filter((r) => r.status === 'present').length,
      late: filtered.filter((r) => r.status === 'late').length,
      absent: filtered.filter((r) => r.status === 'absent').length,
    }),
    [filtered],
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

  return (
    <div className="space-y-4">
      <AdminSectionNav />
      <h1 className="text-lg font-bold text-ppme-primary">{t('admin.tutorAttendanceTitle')}</h1>

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

      {tutorsLoading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : tutors.length === 0 ? (
        <p className="text-ppme-text/60">{t('admin.tutorAttendanceNoData')}</p>
      ) : (
        <>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <label className="block text-sm font-medium text-ppme-text">
              {t('admin.tutorAttendancePickTutor')}
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-black/10 bg-white px-3 text-ppme-text"
                value={tutorId ?? ''}
                onChange={(e) => setTutorId(e.target.value)}
              >
                {tutors.map((tut) => (
                  <option key={tut.user_id} value={tut.user_id}>
                    {tut.full_name}
                  </option>
                ))}
              </select>
            </label>
            {classNames.length > 1 && (
              <label className="mt-3 block text-sm font-medium text-ppme-text">
                {t('common.selectClass')}
                <select
                  className="mt-1 min-h-11 w-full rounded-lg border border-black/10 bg-white px-3 text-ppme-text"
                  value={classFilter}
                  onChange={(e) => setClassFilter(e.target.value)}
                >
                  <option value="">{t('admin.allGroups')}</option>
                  {classNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

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
            <p className="mt-2 text-xs text-ppme-text/60">
              {t('admin.tutorAttendanceCounts', counts)}
            </p>
          </div>

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
                      <p className="text-xs text-ppme-text/60">
                        {row.className}
                        {row.status === 'absent' && row.reason ? ` — ${row.reason}` : ''}
                      </p>
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
        </>
      )}
    </div>
  )
}
