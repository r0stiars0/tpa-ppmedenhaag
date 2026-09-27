import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { overviewTutors, tutorOverview, type Mark } from '../../lib/attendanceStats'
import { getErrorMessage } from '../../lib/errors'
import { academicYearWindow, currentAcademicYear } from '../../lib/reports'
import { AttendanceLegend, AttendanceMark, markLabel } from './AttendanceMark'
import { fetchTutorOverviewData, todayLocalDate, type TutorOverviewData } from './api'

const COLUMNS = 8
const LEGEND: readonly Mark[] = ['present', 'late', 'absent', 'notRecorded', 'noSession']

/**
 * Hadir › Guru — every tutor's attendance at a glance, admin only (TAD
 * ADR-046(d)/(e)). Replaces the Beheer "Kehadiran Guru" page. One row
 * per tutor: the last 8 held sessions as marks and the rate over the
 * filtered range; tapping a row opens that tutor's detail. Recording
 * stays in the register — this screen writes nothing.
 */
export function TutorAttendanceOverview() {
  const { t, i18n } = useTranslation()
  const [from, setFrom] = useState(() => academicYearWindow(currentAcademicYear()).start)
  const [to, setTo] = useState(() => todayLocalDate())
  const [classFilter, setClassFilter] = useState('')
  const [data, setData] = useState<TutorOverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    fetchTutorOverviewData(from, to)
      .then((result) => {
        if (active) setData(result)
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
  }, [from, to])

  const view = useMemo(() => {
    if (!data) return null
    const withSessions = new Set(data.sessions.map((s) => s.classId))
    // Active groups, plus an archived one that met in this range.
    const groupOptions = data.classes.filter((c) => !c.archived || withSessions.has(c.id))
    const classIds = classFilter ? [classFilter] : groupOptions.map((c) => c.id)
    const inFilter = new Set(classIds)
    const sessions = data.sessions.filter((s) => inFilter.has(s.classId))
    const sessionIds = new Set(sessions.map((s) => s.id))
    const rows = data.rows.filter((r) => sessionIds.has(r.sessionId))
    const names = Object.fromEntries(rows.map((r) => [r.tutorId, data.names[r.tutorId] ?? '']))
    const tutors = overviewTutors({ classIds, tutorsByClass: data.tutorsByClass, names })
    const className = new Map(data.classes.map((c) => [c.id, c.name]))
    return {
      groupOptions,
      tutors,
      sessions,
      rows,
      className,
      overview: tutorOverview({ tutors, sessions, rows, n: COLUMNS }),
    }
  }, [data, classFilter])

  const formatDate = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language === 'nl' ? 'nl-NL' : 'id-ID', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    return (date: string) => fmt.format(new Date(`${date}T00:00:00`))
  }, [i18n.language])

  const detail = useMemo(() => {
    if (!view || !selected) return null
    const summary = view.overview.tutors.find((x) => x.id === selected)
    const tutor = view.tutors.find((x) => x.id === selected)
    if (!summary || !tutor) return null
    const taught = new Set(tutor.classIds)
    const own = new Map(view.rows.filter((r) => r.tutorId === selected).map((r) => [r.sessionId, r]))
    // Every session in range that concerns this tutor: recorded, or held
    // in a group they teach and not recorded. Oldest-first for the strip.
    const entries = view.sessions
      .filter((s) => own.has(s.id) || (s.held && taught.has(s.classId)))
      .map((s) => {
        const row = own.get(s.id)
        return {
          id: s.id,
          date: s.date,
          group: view.className.get(s.classId) ?? '',
          mark: (row?.status ?? 'notRecorded') as Mark,
          reason: row?.status === 'absent' ? row.reason : null,
        }
      })
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.group.localeCompare(b.group)))
    return { summary, entries }
  }, [view, selected])

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-white p-4 shadow-sm">
        {view && view.groupOptions.length > 1 && (
          <label className="mb-3 block text-sm font-medium text-ppme-text">
            {t('common.selectClass')}
            <select
              className="mt-1 min-h-11 w-full rounded-lg border border-black/10 bg-white px-3 text-ppme-text"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
            >
              <option value="">{t('admin.allGroups')}</option>
              {view.groupOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-ppme-text/70">
            {t('common.from')}
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
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
              onChange={(e) => e.target.value && setTo(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
            />
          </label>
        </div>
      </div>

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

      {loading || !view ? (
        !error && <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : view.overview.tutors.length === 0 || view.overview.columns.length === 0 ? (
        <p className="text-ppme-text/60">{t('attendance.tutorOverviewEmpty')}</p>
      ) : (
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <div className="flex justify-between pb-2 text-xs font-semibold text-ppme-text/70">
            <span>{t('attendance.tutorOverviewColumn', { count: view.overview.columns.length })}</span>
            <span>{t('attendance.rateColumn')}</span>
          </div>
          <ul>
            {view.overview.tutors.map((row) => {
              const isSelected = row.id === selected
              const rate = row.rate === null ? t('attendance.noRateYet') : `${Math.round(row.rate)}%`
              return (
                <li key={row.id} className="border-t border-black/5">
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${row.name}: ${rate} — ${t('attendance.tutorCounts', row.counts)}`}
                    onClick={() => setSelected(isSelected ? null : row.id)}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto_3.5rem] items-center gap-2 rounded-md px-1 py-2 text-left ${
                      isSelected ? 'bg-ppme-primary/5' : ''
                    }`}
                  >
                    <span className={`truncate text-sm text-ppme-text ${isSelected ? 'font-bold' : 'font-medium'}`}>
                      {row.name}
                    </span>
                    <span className="flex gap-1" aria-hidden="true">
                      {row.marks.map((mark, i) => (
                        <AttendanceMark key={view.overview.columns[i]} mark={mark} tone="tutor" />
                      ))}
                    </span>
                    <span className="text-right text-sm font-bold text-ppme-text">{rate}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="mt-3 space-y-2 border-t border-black/5 pt-3">
            <AttendanceLegend tone="tutor" marks={LEGEND} />
            <p className="text-xs text-ppme-text/60">
              {t('attendance.newestRight')} {t('attendance.tutorOverviewHint')}
            </p>
          </div>
        </div>
      )}

      {detail && (
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-ppme-text">{detail.summary.name}</h2>
              <p className="text-xs text-ppme-text/70">{t('attendance.tutorCounts', detail.summary.counts)}</p>
            </div>
            <p className="text-3xl font-bold leading-tight text-ppme-text">
              {detail.summary.rate === null ? t('attendance.noRateYet') : `${Math.round(detail.summary.rate)}%`}
            </p>
          </div>
          <p className="mt-3 text-xs font-semibold text-ppme-text/70">{t('attendance.tutorDetailSessions')}</p>
          <div className="mt-1 flex flex-wrap gap-1.5" aria-hidden="true">
            {detail.entries.map((e) => (
              <AttendanceMark key={e.id} mark={e.mark} tone="tutor" size={14} />
            ))}
          </div>
          <ul className="mt-3 space-y-1">
            {[...detail.entries].reverse().map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 border-t border-black/5 pt-1.5 text-sm">
                <span className="flex flex-col">
                  <span className="text-ppme-text">{formatDate(e.date)}</span>
                  <span className="text-xs text-ppme-text/60">{e.group}</span>
                </span>
                <span className="flex flex-col items-end">
                  <span className="flex items-center gap-1.5 font-semibold text-ppme-text">
                    <AttendanceMark mark={e.mark} tone="tutor" />
                    {markLabel(e.mark, t)}
                  </span>
                  {e.reason && <span className="text-xs text-ppme-text/60">{e.reason}</span>}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="mt-3 min-h-11 w-full rounded-lg border border-black/10 px-4 text-sm font-semibold text-ppme-text"
          >
            {t('attendance.closeDetail')}
          </button>
        </div>
      )}

      <p className="text-xs text-ppme-text/60">{t('attendance.tutorOverviewNote')}</p>
    </div>
  )
}
