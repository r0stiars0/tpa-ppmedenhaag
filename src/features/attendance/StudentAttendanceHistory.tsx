import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ratesByGroup } from '../../lib/attendance'
import { getErrorMessage } from '../../lib/errors'
import { fetchAttendanceHistory, type AttendanceHistoryRow } from './api'

const SHOWN = 10

/**
 * A child's attendance across all their groups, opened from a register
 * row (PRD Feature 8 FR-006, AC-012) — so a tutor who receives a child
 * mid-year, or who shares a child with another group, sees that child's
 * record without seeing anyone else's.
 *
 * Read through `fn_student_attendance_history`: the absence reason comes
 * back only for sessions of the caller's own groups; for another group's
 * session it is null and only the status shows (Resolved Decision 16).
 */
export function StudentAttendanceHistory({ studentId }: { studentId: string }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<AttendanceHistoryRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || rows !== null) return
    let active = true
    fetchAttendanceHistory(studentId)
      .then((data) => {
        if (active) setRows(data)
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err))
      })
    return () => {
      active = false
    }
  }, [open, rows, studentId])

  const rates = useMemo(() => ratesByGroup(rows ?? []), [rows])
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language === 'nl' ? 'nl-NL' : 'id-ID', { day: 'numeric', month: 'short' }),
    [i18n.language],
  )

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="min-h-11 text-xs font-medium text-ppme-primary"
      >
        {open ? t('attendance.hideHistory') : t('attendance.showHistory')}
      </button>
      {open && (
        <div className="space-y-2 border-t border-black/5 pt-2 text-xs text-ppme-text/80">
          {error && <p className="text-ppme-danger">{error}</p>}
          {rows === null && !error && <p className="text-ppme-text/60">{t('common.loading')}</p>}
          {rows !== null && rows.length === 0 && <p className="text-ppme-text/60">{t('common.empty')}</p>}
          {rows !== null && rows.length > 0 && (
            <>
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {rates.groups.map((group) => (
                  <li key={group.classId}>
                    {group.className}: <span className="font-semibold text-ppme-primary">{group.rate}%</span>
                  </li>
                ))}
              </ul>
              <ul className="space-y-1">
                {rows.slice(0, SHOWN).map((row) => (
                  <li key={row.id} className="flex justify-between gap-2">
                    <span>
                      {dateFormatter.format(new Date(`${row.date}T00:00:00`))} · {row.className}
                      {row.reason && <span className="text-ppme-text/60"> · {row.reason}</span>}
                    </span>
                    <span className={row.status === 'absent' ? 'font-semibold text-ppme-danger' : ''}>
                      {row.status === 'absent' ? t('attendance.notPresent') : t(`attendance.${row.status}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
