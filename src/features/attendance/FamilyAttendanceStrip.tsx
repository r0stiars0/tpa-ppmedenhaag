import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { computeAttendanceRate } from '../../lib/attendance'
import { lastMarks } from '../../lib/attendanceStats'
import { AttendanceLegend, AttendanceMark, markLabel } from './AttendanceMark'
import type { AttendanceHistoryRow } from './api'

const MARKS = 8

function useDateFormat() {
  const { i18n } = useTranslation()
  return useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language === 'nl' ? 'nl-NL' : 'id-ID', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
    return (date: string) => fmt.format(new Date(`${date}T00:00:00`))
  }, [i18n.language])
}

/**
 * A child's last 8 recorded sessions as tappable marks (TAD ADR-046(b)),
 * oldest left. Tapping one shows its date, group, status and — for an
 * absence — the reason, which this family already sees in the history
 * list below. Each mark is a 24px-wide, 44px-tall button with a spoken
 * label, so the strip works without seeing shape or colour.
 */
export function AttendanceStrip({
  rows,
  name,
  size = 12,
  onPick,
}: {
  rows: readonly AttendanceHistoryRow[]
  /** Prefixed to each mark's spoken label when several children share a card. */
  name?: string
  size?: number
  onPick?: () => void
}) {
  const { t } = useTranslation()
  const formatDate = useDateFormat()
  const [picked, setPicked] = useState<string | null>(null)
  const marks = lastMarks(rows, MARKS)
  const current = marks.find((r) => `${r.id}:${r.classId}` === picked) ?? null

  if (marks.length === 0) {
    return <p className="text-xs text-ppme-text/60">{t('attendance.noSessionsInRange')}</p>
  }

  return (
    <div className="space-y-2">
      <div className="flex">
        {marks.map((row) => {
          const key = `${row.id}:${row.classId}`
          const status = markLabel(row.status, t)
          return (
            <button
              key={key}
              type="button"
              aria-pressed={picked === key}
              aria-label={`${name ? `${name}, ` : ''}${t('attendance.markLabel', {
                date: formatDate(row.date),
                group: row.className,
                status,
              })}`}
              onClick={() => {
                setPicked(picked === key ? null : key)
                onPick?.()
              }}
              className={`flex min-h-11 items-center justify-center rounded-md ${size > 12 ? 'w-9' : 'w-6'} ${
                picked === key ? 'bg-ppme-primary/15' : ''
              }`}
            >
              <AttendanceMark mark={row.status} tone="student" size={size} />
            </button>
          )
        })}
      </div>
      {current && (
        <div className="flex justify-between gap-3 rounded-md bg-ppme-primary/5 px-3 py-2 text-sm">
          <span className="flex flex-col">
            <span className="font-semibold text-ppme-text">
              {name ? `${name} · ` : ''}
              {formatDate(current.date)}
            </span>
            <span className="text-xs text-ppme-text/70">{current.className}</span>
          </span>
          <span className="flex flex-col items-end">
            <span className="font-semibold text-ppme-text">{markLabel(current.status, t)}</span>
            {current.status === 'absent' && current.reason && (
              <span className="text-xs text-ppme-text/70">{current.reason}</span>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Every child in one card (TAD ADR-046(b)) — replaces the child picker
 * on the family Attendance screen. One row per child: name and groups,
 * their strip, and their rate over the chosen range (the same number as
 * the rate card below). Tapping a name selects the child for the rate
 * card and history; tapping a mark shows that session.
 */
export function ChildrenAttendanceCard({
  students,
  selectedId,
  onSelect,
}: {
  students: readonly { id: string; name: string; groups: string[]; rows: readonly AttendanceHistoryRow[] }[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <div className="flex justify-between pb-2 text-xs font-semibold text-ppme-text/70">
        <span>{t('attendance.childrenGraph', { count: MARKS })}</span>
        <span>{t('attendance.rateColumn')}</span>
      </div>
      <ul>
        {students.map((child) => {
          const selected = child.id === selectedId
          // Unrounded, exactly as the rate card below prints it.
          const rate = child.rows.length === 0 ? null : computeAttendanceRate(child.rows.map((r) => r.status))
          return (
            <li
              key={child.id}
              className={`grid grid-cols-[minmax(0,1fr)_3.75rem] items-center gap-x-2 border-t border-black/5 py-2 sm:grid-cols-[minmax(0,1fr)_auto_3.75rem] ${
                selected ? 'rounded-md bg-ppme-primary/5' : ''
              }`}
            >
              <button
                type="button"
                aria-pressed={selected}
                aria-label={t('attendance.selectChildNamed', { name: child.name })}
                onClick={() => onSelect(child.id)}
                className="flex min-h-11 flex-col justify-center px-1 text-left"
              >
                <span className={`text-sm text-ppme-text ${selected ? 'font-bold' : 'font-semibold'}`}>
                  {child.name}
                </span>
                {child.groups.length > 0 && (
                  <span className="text-xs text-ppme-text/60">{child.groups.join(' · ')}</span>
                )}
              </button>
              <span className="text-right text-base font-bold text-ppme-text sm:order-last">
                {rate === null ? '—' : `${rate}%`}
              </span>
              <div className="col-span-2 px-1 sm:col-span-1">
                <AttendanceStrip rows={child.rows} name={child.name} onPick={() => onSelect(child.id)} />
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-3 space-y-2 border-t border-black/5 pt-3">
        <AttendanceLegend tone="student" marks={['present', 'late', 'absent']} />
        <p className="text-xs text-ppme-text/60">
          {t('attendance.newestRight')} {t('attendance.childrenGraphHint')}
        </p>
      </div>
    </div>
  )
}
