import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useViewScope } from '../../context/ViewScopeContext'
import { useMyStudents } from '../../hooks/useMyStudents'
import { hasFamilyScope } from '../../lib/viewScope'
import { supabase } from '../../lib/supabase'
import { getErrorMessage } from '../../lib/errors'
import { startOfWeekLocalDate } from '../../lib/murajaah'
import { localDate } from '../murajaah/api'
import {
  attendancePercent,
  fetchWeeklyActivity,
  hasActivity,
  type WeeklyActivity,
} from '../../lib/weeklySummary'

/**
 * The week the Friday digest is about.
 *
 * This card is the in-app half of `weekly-progress-digest`. DPIA R6
 * keeps the attendance figure off the lock screen, so the notification
 * can only say a summary is ready — which means the summary has to be
 * somewhere, and it is here, behind a login (TAD ADR-016, and ADR-015(b)
 * for the two-tier pattern it follows).
 *
 * Mon–Sun to today, matching the tutor overview's week (FR-004) and the
 * digest's own window, so a parent and a tutor talking about "this week"
 * mean the same days. The percentage is over the sessions the child was
 * actually marked in, and a week with none says so rather than
 * reporting 0% — over a school holiday that would be every family being
 * told their child attended nothing.
 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ppme-bg-alt px-3 py-2">
      <p className="text-lg font-bold text-ppme-primary">{value}</p>
      <p className="text-xs text-ppme-text/60">{label}</p>
    </div>
  )
}

export function WeeklySummary() {
  const { t } = useTranslation()
  const { capabilities } = useViewScope()
  const { students, loading: studentsLoading } = useMyStudents()

  const [activity, setActivity] = useState<Map<string, WeeklyActivity>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // A relationship, not a role (ADR-025). This gate used to read
  // `role === 'parent' || role === 'student'`, which meant the one
  // person most likely to want the card — an ustadzah whose own child
  // attends — never saw it, and got the Friday notification saying a
  // summary was ready with nothing behind it. ADR-019(d) recorded that
  // as a known consequence to close here. It stays independent of the
  // scope switch: this is the dashboard, and the card is about their own
  // children whichever shape the six feature screens are currently in.
  const isFamily = hasFamilyScope(capabilities)

  useEffect(() => {
    if (!isFamily || studentsLoading) return
    if (students.length === 0) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)

    fetchWeeklyActivity(
      supabase,
      students.map((s) => s.id),
      { from: startOfWeekLocalDate(), to: localDate(), toLocalDate: (iso) => localDate(new Date(iso)) },
    )
      .then((result) => {
        if (!active) return
        setActivity(result)
        setError(null)
      })
      .catch((err) => active && setError(getErrorMessage(err)))
      .finally(() => active && setLoading(false))

    return () => {
      active = false
    }
  }, [isFamily, students, studentsLoading])

  if (!isFamily) return null
  if (studentsLoading || loading) return null
  if (error) {
    return <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>
  }

  const withActivity = students.filter((student) => {
    const week = activity.get(student.id)
    return week !== undefined && hasActivity(week)
  })
  if (withActivity.length === 0) return null

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-ppme-text/70">{t('dashboard.thisWeek')}</h2>
      <div className="mt-3 space-y-4">
        {withActivity.map((student) => {
          const week = activity.get(student.id)!
          const percent = attendancePercent(week)
          return (
            <div key={student.id}>
              <p className="text-sm font-medium text-ppme-text">{student.full_name}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label={t('dashboard.attendance')}
                  value={percent === null ? '—' : `${percent}%`}
                />
                <Stat label={t('nav.yanbua')} value={String(week.yanbua)} />
                <Stat label={t('nav.alquran')} value={String(week.quran)} />
                <Stat label={t('nav.murajaah')} value={String(week.murajaah)} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
