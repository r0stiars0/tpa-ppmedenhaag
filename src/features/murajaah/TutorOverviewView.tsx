import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMyClasses } from '../../hooks/useMyClasses'
import { ClassPicker } from '../../components/ClassPicker'
import { fetchRecordableRoster, type RosterStudent } from '../../lib/roster'
import { useViewScope } from '../../context/ViewScopeContext'
import type { SurahRef } from '../../lib/quran'
import { getErrorMessage } from '../../lib/errors'
import { isStreakCurrent, startOfWeekLocalDate } from '../../lib/murajaah'
import { fetchSurahs } from '../quran/api'
import {
  fetchActiveAssignmentsForStudents,
  fetchLogsForAssignments,
  todayLocalDate,
  type MurajaahAssignment,
  type MurajaahLog,
} from './api'

/**
 * FR-004: class-wide view of which students have/haven't confirmed home
 * Murajaah practice — same whole-roster-at-once shape as
 * TutorAttendanceView, unlike the per-student drill-down in
 * TutorAssignView. Read-only: tutors have no write path into
 * `murajaah_log` (see api.ts's `setAssignmentActive` docstring).
 */
export function TutorOverviewView() {
  const { t } = useTranslation()
  const { classes, loading: classesLoading } = useMyClasses()
  const { selfStudentId } = useViewScope()

  const [classId, setClassId] = useState<string | null>(null)
  const [roster, setRoster] = useState<RosterStudent[]>([])
  const [surahs, setSurahs] = useState<SurahRef[]>([])
  const [assignments, setAssignments] = useState<MurajaahAssignment[]>([])
  const [weekLogs, setWeekLogs] = useState<MurajaahLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchSurahs()
      .then(setSurahs)
      .catch((err) => setError(getErrorMessage(err)))
  }, [])

  useEffect(() => {
    if (!classId && classes.length > 0) setClassId(classes[0].id)
  }, [classes, classId])

  useEffect(() => {
    if (!classId) return
    let active = true
    setLoading(true)
    setError(null)

    async function load() {
      try {
        const rosterData = await fetchRecordableRoster(classId!, selfStudentId)
        if (!active) return
        setRoster(rosterData)

        const assignmentData = await fetchActiveAssignmentsForStudents(rosterData.map((s) => s.id))
        if (!active) return
        setAssignments(assignmentData)

        const logData = await fetchLogsForAssignments(
          assignmentData.map((a) => a.id),
          startOfWeekLocalDate(),
        )
        if (!active) return
        setWeekLogs(logData)
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
  }, [classId, selfStudentId])

  const today = todayLocalDate()
  const assignmentsByStudent = useMemo(() => {
    const map = new Map<string, MurajaahAssignment[]>()
    for (const a of assignments) {
      const list = map.get(a.student_id) ?? []
      list.push(a)
      map.set(a.student_id, list)
    }
    return map
  }, [assignments])
  const logsByAssignment = useMemo(() => {
    const map = new Map<string, MurajaahLog[]>()
    for (const log of weekLogs) {
      const list = map.get(log.assignment_id) ?? []
      list.push(log)
      map.set(log.assignment_id, list)
    }
    return map
  }, [weekLogs])

  const rows = useMemo(
    () =>
      roster.map((student) => {
        const studentAssignments = assignmentsByStudent.get(student.id) ?? []
        const studentLogs = studentAssignments.flatMap((a) => logsByAssignment.get(a.id) ?? [])
        const confirmedToday = studentLogs.some((l) => isStreakCurrent(l.date, today))
        const confirmedDaysThisWeek = new Set(studentLogs.map((l) => l.date)).size
        return {
          student,
          hasTarget: studentAssignments.length > 0,
          confirmedToday,
          confirmedDaysThisWeek,
        }
      }),
    [roster, assignmentsByStudent, logsByAssignment, today],
  )

  const percentToday =
    roster.length === 0 ? 0 : Math.round((rows.filter((r) => r.confirmedToday).length / roster.length) * 100)

  if (classesLoading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (classes.length === 0) return <p className="text-ppme-text/60">{t('common.noClassesAssigned')}</p>

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <ClassPicker classes={classes} value={classId} onChange={setClassId} />
      </div>

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

      {!loading && roster.length > 0 && (
        <p className="rounded-lg bg-white p-4 text-center text-sm font-semibold text-ppme-primary shadow-sm">
          {t('murajaah.percentToday', { percent: percentToday })}
        </p>
      )}

      {loading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : roster.length === 0 ? (
        <p className="text-ppme-text/60">{t('common.noStudentsInClass')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ student, hasTarget, confirmedToday, confirmedDaysThisWeek }) => {
            const surah = surahs.find(
              (s) => s.surah_num === (assignmentsByStudent.get(student.id)?.[0]?.surah_num ?? -1),
            )
            return (
              <li key={student.id} className="rounded-lg bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-ppme-text">{student.full_name}</p>
                    <p className="text-xs text-ppme-text/60">
                      {hasTarget
                        ? (surah?.transliteration ??
                          t('quran.surahNumber', {
                            number: assignmentsByStudent.get(student.id)?.[0]?.surah_num,
                          }))
                        : t('murajaah.noActiveTarget')}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        confirmedToday
                          ? 'bg-ppme-success/10 text-ppme-success'
                          : 'bg-ppme-bg-alt text-ppme-text/60'
                      }`}
                    >
                      {confirmedToday ? t('murajaah.confirmDone') : t('murajaah.notConfirmedToday')}
                    </span>
                    {hasTarget && (
                      <span className="text-xs text-ppme-text/50">
                        {confirmedDaysThisWeek}/7 {t('murajaah.thisWeek').toLowerCase()}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
