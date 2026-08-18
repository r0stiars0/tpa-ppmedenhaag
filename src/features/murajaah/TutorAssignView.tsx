import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useMyClasses } from '../../hooks/useMyClasses'
import { ClassPicker } from '../../components/ClassPicker'
import { fetchRecordableRoster, type RosterStudent } from '../../lib/roster'
import { useViewScope } from '../../context/ViewScopeContext'
import type { SurahRef } from '../../lib/quran'
import { getErrorMessage } from '../../lib/errors'
import { FREQUENCY_OPTIONS, FREQUENCY_LABEL_KEY } from '../../lib/murajaah'
import type { Database } from '../../lib/database.types'
import { fetchSurahs } from '../quran/api'
import { SurahSelect } from '../quran/SurahSelect'
import {
  createAssignment,
  fetchAllLogsForAssignments,
  fetchAssignmentsForStudent,
  setAssignmentActive,
  type MurajaahAssignment,
  type MurajaahLog,
} from './api'
import { AssignmentCard } from './AssignmentCard'
import { MurajaahTimeline } from './MurajaahTimeline'

type MurajaahFrequency = Database['public']['Enums']['murajaah_frequency']

export function TutorAssignView() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const { classes, loading: classesLoading } = useMyClasses()
  const { selfStudentId } = useViewScope()

  const [classId, setClassId] = useState<string | null>(null)
  const [roster, setRoster] = useState<RosterStudent[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [surahs, setSurahs] = useState<SurahRef[]>([])

  const [selectedStudent, setSelectedStudent] = useState<RosterStudent | null>(null)
  const [assignments, setAssignments] = useState<MurajaahAssignment[]>([])
  const [logs, setLogs] = useState<MurajaahLog[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const [showAssign, setShowAssign] = useState(false)
  const [surahNum, setSurahNum] = useState(1)
  const [ayahFrom, setAyahFrom] = useState(1)
  const [ayahTo, setAyahTo] = useState(1)
  const [frequency, setFrequency] = useState<MurajaahFrequency>('daily')
  const [saving, setSaving] = useState(false)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
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
    setRosterLoading(true)
    fetchRecordableRoster(classId, selfStudentId)
      .then((data) => {
        if (active) setRoster(data)
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err))
      })
      .finally(() => {
        if (active) setRosterLoading(false)
      })
    return () => {
      active = false
    }
  }, [classId, selfStudentId])

  const currentAyahCount = surahs.find((s) => s.surah_num === surahNum)?.ayah_count ?? 286

  function openStudent(student: RosterStudent) {
    setSelectedStudent(student)
    setShowAssign(false)
    setBanner(null)
    setError(null)
    loadDetail(student.id)
  }

  function loadDetail(studentId: string) {
    setDetailLoading(true)
    fetchAssignmentsForStudent(studentId)
      .then(async (assignmentData) => {
        setAssignments(assignmentData)
        const logData = await fetchAllLogsForAssignments(assignmentData.map((a) => a.id))
        setLogs(logData)
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setDetailLoading(false))
  }

  function openAssignForm() {
    setSurahNum(1)
    setAyahFrom(1)
    setAyahTo(1)
    setFrequency('daily')
    setBanner(null)
    setError(null)
    setShowAssign(true)
  }

  async function handleAssign() {
    if (!selectedStudent || !profile) return
    setSaving(true)
    setError(null)
    try {
      const created = await createAssignment({
        student_id: selectedStudent.id,
        tutor_id: profile.id,
        surah_num: surahNum,
        ayah_from: ayahFrom,
        ayah_to: ayahTo,
        frequency,
      })
      setAssignments((prev) => [created, ...prev])
      setBanner(t('murajaah.targetAssigned'))
      setShowAssign(false)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleMarkMemorized(assignment: MurajaahAssignment) {
    setMarkingId(assignment.id)
    setError(null)
    try {
      const updated = await setAssignmentActive(assignment.id, false)
      setAssignments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
      setBanner(t('murajaah.memorized'))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setMarkingId(null)
    }
  }

  const activeAssignments = assignments.filter((a) => a.active)
  const memorizedAssignments = assignments.filter((a) => !a.active)

  if (classesLoading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (classes.length === 0) return <p className="text-ppme-text/60">{t('common.noClassesAssigned')}</p>

  if (!selectedStudent) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <ClassPicker classes={classes} value={classId} onChange={setClassId} />
        </div>
        {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}
        {rosterLoading ? (
          <p className="text-ppme-text/60">{t('common.loading')}</p>
        ) : roster.length === 0 ? (
          <p className="text-ppme-text/60">{t('common.noStudentsInClass')}</p>
        ) : (
          <ul className="space-y-2">
            {roster.map((student) => (
              <li key={student.id}>
                <button
                  type="button"
                  onClick={() => openStudent(student)}
                  className="min-h-11 w-full rounded-lg bg-white p-4 text-left font-medium text-ppme-text shadow-sm hover:bg-ppme-bg-alt"
                >
                  {student.full_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setSelectedStudent(null)}
        className="min-h-11 text-sm font-medium text-ppme-primary"
      >
        ← {t('common.back')}
      </button>

      <h2 className="text-base font-semibold text-ppme-text">{selectedStudent.full_name}</h2>

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}
      {banner && (
        <p className="rounded-lg bg-ppme-accent/15 p-3 text-sm font-medium text-ppme-primary">{banner}</p>
      )}

      {detailLoading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : (
        <>
          {activeAssignments.length === 0 ? (
            <p className="rounded-lg bg-white p-4 text-center text-ppme-text/60 shadow-sm">
              {t('murajaah.noActiveTarget')}
            </p>
          ) : (
            <div className="space-y-3">
              {activeAssignments.map((assignment) => (
                <AssignmentCard key={assignment.id} assignment={assignment} surahs={surahs}>
                  <button
                    type="button"
                    disabled={markingId === assignment.id}
                    onClick={() => void handleMarkMemorized(assignment)}
                    className="min-h-11 w-full rounded-lg bg-ppme-accent px-4 text-sm font-semibold text-white shadow-sm hover:bg-ppme-accent/90 disabled:opacity-60"
                  >
                    {markingId === assignment.id ? t('common.loading') : t('murajaah.markMemorized')}
                  </button>
                </AssignmentCard>
              ))}
            </div>
          )}

          {showAssign ? (
            <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-ppme-text">{t('murajaah.target')}</h3>

              <SurahSelect surahs={surahs} value={surahNum} onChange={setSurahNum} />

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-ppme-text/70">
                  {t('common.ayah')} {t('common.from')}
                  <input
                    type="number"
                    min={1}
                    max={currentAyahCount}
                    value={ayahFrom}
                    onChange={(e) => setAyahFrom(Number(e.target.value))}
                    className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
                  />
                </label>
                <label className="text-xs font-medium text-ppme-text/70">
                  {t('common.ayah')} {t('common.to')}
                  <input
                    type="number"
                    min={1}
                    max={currentAyahCount}
                    value={ayahTo}
                    onChange={(e) => setAyahTo(Number(e.target.value))}
                    className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
                  />
                </label>
              </div>

              <label className="block text-xs font-medium text-ppme-text/70">
                {t('murajaah.frequency')}
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as MurajaahFrequency)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
                >
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {t(FREQUENCY_LABEL_KEY[opt])}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saving || ayahFrom < 1 || ayahTo < ayahFrom || ayahTo > currentAyahCount}
                  onClick={() => void handleAssign()}
                  className="min-h-11 flex-1 rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
                >
                  {saving ? t('common.loading') : t('common.save')}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setShowAssign(false)}
                  className="min-h-11 flex-1 rounded-lg border border-black/10 px-4 font-semibold text-ppme-text"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={openAssignForm}
              className="min-h-11 w-full rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark"
            >
              {t('murajaah.assignNew')}
            </button>
          )}

          {memorizedAssignments.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ppme-text/70">{t('murajaah.portfolio')}</h3>
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
            <h3 className="mb-2 text-sm font-semibold text-ppme-text/70">{t('murajaah.history')}</h3>
            <MurajaahTimeline entries={logs} />
          </div>
        </>
      )}
    </div>
  )
}
