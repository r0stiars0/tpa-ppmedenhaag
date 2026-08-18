import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useMyStudents } from '../../hooks/useMyStudents'
import { useViewScope } from '../../context/ViewScopeContext'
import { isSelfRecord } from '../../lib/capabilities'
import { ChildPicker } from '../../components/ChildPicker'
import type { SurahRef } from '../../lib/quran'
import { getErrorMessage } from '../../lib/errors'
import { computeBestStreak, computeStreak, isStreakCurrent } from '../../lib/murajaah'
import { isNetworkError } from '../../lib/network'
import { offlineQueue } from '../../lib/offlineQueue'
import type { Database, TablesInsert } from '../../lib/database.types'
import {
  confirmPractice,
  fetchAllLogsForAssignments,
  fetchAssignmentsForStudent,
  localDate,
  todayLocalDate,
  type MurajaahAssignment,
  type MurajaahLog,
} from './api'
import { fetchSurahs } from '../quran/api'
import { AssignmentCard } from './AssignmentCard'
import { MurajaahTimeline } from './MurajaahTimeline'
import { QUALITY_LABEL_KEY, QUALITY_OPTIONS } from './quality'

type MurajaahQuality = Database['public']['Enums']['murajaah_quality']

export function FamilyMurajaahView() {
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const { selfStudentId } = useViewScope()
  const { students, loading: studentsLoading } = useMyStudents()

  const [studentId, setStudentId] = useState<string | null>(null)
  const [surahs, setSurahs] = useState<SurahRef[]>([])
  const [assignments, setAssignments] = useState<MurajaahAssignment[]>([])
  const [logs, setLogs] = useState<MurajaahLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState(false)
  const [quality, setQuality] = useState<MurajaahQuality>('hafal_lancar')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  useEffect(() => {
    fetchSurahs()
      .then(setSurahs)
      .catch((err) => setError(getErrorMessage(err)))
  }, [])

  useEffect(() => {
    if (!studentId && students.length > 0) setStudentId(students[0].id)
  }, [students, studentId])

  useEffect(() => {
    if (!studentId) return
    let active = true
    setLoading(true)
    setError(null)

    async function load() {
      try {
        const assignmentData = await fetchAssignmentsForStudent(studentId!)
        if (!active) return
        setAssignments(assignmentData)
        const logData = await fetchAllLogsForAssignments(assignmentData.map((a) => a.id))
        if (!active) return
        setLogs(logData)
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
  }, [studentId])

  const today = todayLocalDate()
  const activeAssignments = useMemo(() => assignments.filter((a) => a.active), [assignments])
  const memorizedAssignments = useMemo(() => assignments.filter((a) => !a.active), [assignments])
  const logsByAssignment = useMemo(() => {
    const map = new Map<string, MurajaahLog[]>()
    for (const log of logs) {
      const list = map.get(log.assignment_id) ?? []
      list.push(log)
      map.set(log.assignment_id, list)
    }
    return map
  }, [logs])

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === 'nl' ? 'nl-NL' : 'id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    [i18n.language],
  )

  // Only a *parent of this child* can confirm home practice, and that is
  // a question about the selected student rather than about the account
  // (ADR-025). RLS says exactly that: `mlog_parent_insert` requires
  // `confirmed_by = auth.uid()` AND the assignment's student to be in
  // `fn_my_children()`, which is `parent_id`-scoped. A 16+ self-login
  // santri looking at their own record has no write policy here at all,
  // matching the PRD's "parent confirms" design — the point is a parent
  // verifying practice happened at home, not self-report.
  //
  // It used to read `profile?.role === 'parent'`, which agreed with the
  // policy for every account that could exist before the scope switch
  // and disagreed the moment one could hold both relationships:
  // Ustadzah Aminah's role column says `tutor`, `fn_my_children()`
  // holds her son Yusuf, and she would have been shown his screens with
  // the confirm control missing and nothing to explain why. RLS-19 and
  // ADR-019 both have her able to confirm for her own child and unable
  // to for a pupil — the row this control writes is the first half, and
  // the second half is not reachable from a family screen at all.
  const canConfirm = !isSelfRecord(studentId, selfStudentId)

  async function handleConfirm(assignment: MurajaahAssignment) {
    if (!profile) return
    setConfirmingId(assignment.id)
    setError(null)
    setQueued(false)
    const row: TablesInsert<'murajaah_log'> = {
      assignment_id: assignment.id,
      confirmed_by: profile.id,
      quality,
      date: today,
    }
    try {
      const created = await confirmPractice(row)
      setLogs((prev) => [created, ...prev])
    } catch (err) {
      if (isNetworkError(err)) {
        await offlineQueue.enqueue('murajaah', row)
        // No server-generated row to prepend, so a local stand-in is
        // shown instead — streaks are computed at read time from the
        // log (`computeStreak`), so this needs nothing beyond what the
        // insert itself would have returned.
        const optimistic: MurajaahLog = {
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          assignment_id: row.assignment_id,
          confirmed_by: row.confirmed_by,
          quality: row.quality,
          date: row.date ?? today,
        }
        setLogs((prev) => [optimistic, ...prev])
        setQueued(true)
      } else {
        setError(getErrorMessage(err))
      }
    } finally {
      setConfirmingId(null)
    }
  }

  const selectedName = useMemo(
    () => students.find((s) => s.id === studentId)?.full_name,
    [students, studentId],
  )
  const title =
    !isSelfRecord(studentId, selfStudentId) && selectedName
      ? t('murajaah.childTitle', { name: selectedName })
      : t('murajaah.myTitle')

  if (studentsLoading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (students.length === 0) return <p className="text-ppme-text/60">{t('common.empty')}</p>

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-ppme-primary">{title}</h1>

      <ChildPicker students={students} value={studentId} onChange={setStudentId} />

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}
      {queued && (
        <p className="rounded-lg bg-ppme-primary/10 p-3 text-sm text-ppme-primary">{t('common.offline')}</p>
      )}

      {loading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : activeAssignments.length === 0 ? (
        <p className="rounded-lg bg-white p-4 text-center text-ppme-text/60 shadow-sm">
          {t('murajaah.noActiveTarget')}
        </p>
      ) : (
        <div className="space-y-3">
          {activeAssignments.map((assignment) => {
            const assignmentLogs = (logsByAssignment.get(assignment.id) ?? []).slice().sort((a, b) =>
              a.date < b.date ? 1 : -1,
            )
            const latest = assignmentLogs[0] ?? null
            const confirmedToday = isStreakCurrent(latest?.date ?? null, today)
            // Derived on read rather than read from a column — ADR-016,
            // and `src/lib/murajaah.ts` for why the column is gone. The
            // unit is the target's own `frequency`, so a `3x_week` card
            // counts weeks and says so.
            const streakInput = {
              logDates: assignmentLogs.map((log) => log.date),
              frequency: assignment.frequency,
              today,
              since: localDate(new Date(assignment.created_at)),
            }
            const streak = computeStreak(streakInput)
            const bestStreak = computeBestStreak(streakInput)
            const unitKey = assignment.frequency === 'daily' ? 'murajaah.streak' : 'murajaah.streakWeeks'
            const bestKey =
              assignment.frequency === 'daily' ? 'murajaah.bestStreak' : 'murajaah.bestStreakWeeks'

            return (
              <AssignmentCard key={assignment.id} assignment={assignment} surahs={surahs}>
                <div className="space-y-3">
                  {latest && (
                    <div>
                      <p className="text-2xl font-bold text-ppme-accent">
                        {streak} {t(unitKey)}
                      </p>
                      {streak > 0 && confirmedToday ? (
                        <p className="text-xs text-ppme-text/50">{t('murajaah.streakEncourage')}</p>
                      ) : (
                        <p className="text-xs text-ppme-text/40">
                          {t('murajaah.lastConfirmed', {
                            date: dateFormatter.format(new Date(`${latest.date}T00:00:00`)),
                          })}
                        </p>
                      )}
                      {bestStreak > streak && (
                        <p className="text-xs text-ppme-text/50">
                          {t(bestKey, { count: bestStreak })}
                        </p>
                      )}
                    </div>
                  )}

                  {confirmedToday ? (
                    <p className="rounded-lg bg-ppme-success/10 p-2 text-center text-sm font-semibold text-ppme-success">
                      {t('murajaah.confirmDone')}
                    </p>
                  ) : canConfirm ? (
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-ppme-text/70">
                        {t('murajaah.fieldQuality')}
                        <select
                          value={quality}
                          onChange={(e) => setQuality(e.target.value as MurajaahQuality)}
                          className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
                        >
                          {QUALITY_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {t(QUALITY_LABEL_KEY[opt])}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={confirmingId === assignment.id}
                        onClick={() => void handleConfirm(assignment)}
                        className="min-h-11 w-full rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
                      >
                        {confirmingId === assignment.id ? t('common.loading') : t('murajaah.confirmDone')}
                      </button>
                    </div>
                  ) : (
                    <p className="text-center text-sm text-ppme-text/60">{t('murajaah.notConfirmedToday')}</p>
                  )}
                </div>
              </AssignmentCard>
            )
          })}
        </div>
      )}

      {memorizedAssignments.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-ppme-text/70">{t('murajaah.portfolio')}</h2>
          <ul className="space-y-2">
            {memorizedAssignments.map((assignment) => {
              const surah = surahs.find((s) => s.surah_num === assignment.surah_num)
              return (
                <li
                  key={assignment.id}
                  className="flex items-center justify-between rounded-lg bg-white p-3 shadow-sm"
                >
                  <span className="text-sm font-medium text-ppme-text">
                    {surah?.transliteration ?? t('quran.surahNumber', { number: assignment.surah_num })} ·{' '}
                    {t('common.ayah')} {assignment.ayah_from}–{assignment.ayah_to}
                  </span>
                  <span className="rounded-full bg-ppme-accent/15 px-3 py-1 text-xs font-semibold text-ppme-primary">
                    {t('murajaah.memorized')}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-ppme-text/70">{t('murajaah.history')}</h2>
        {loading ? (
          <p className="text-ppme-text/60">{t('common.loading')}</p>
        ) : (
          <MurajaahTimeline entries={logs.slice().sort((a, b) => (a.date < b.date ? 1 : -1))} />
        )}
      </div>
    </div>
  )
}
