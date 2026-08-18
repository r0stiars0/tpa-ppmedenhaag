import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useMyClasses } from '../../hooks/useMyClasses'
import { ClassPicker } from '../../components/ClassPicker'
import { fetchRecordableRoster, type RosterStudent } from '../../lib/roster'
import { useViewScope } from '../../context/ViewScopeContext'
import type { SurahRef } from '../../lib/quran'
import { getErrorMessage } from '../../lib/errors'
import { isNetworkError } from '../../lib/network'
import { offlineQueue } from '../../lib/offlineQueue'
import { fetchQuranHistory, fetchSurahs, insertQuranProgress, type QuranProgress } from './api'
import { CurrentPositionCard } from './CurrentPositionCard'
import { QuranTimeline } from './QuranTimeline'
import { SurahSelect } from './SurahSelect'
import { QUALITY_LABEL_KEY, QUALITY_OPTIONS } from './quality'
import type { Database, TablesInsert } from '../../lib/database.types'

type QuranQuality = Database['public']['Enums']['quran_quality']

export function TutorQuranView() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const { classes, loading: classesLoading } = useMyClasses()
  const { selfStudentId } = useViewScope()

  const [classId, setClassId] = useState<string | null>(null)
  const [roster, setRoster] = useState<RosterStudent[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [surahs, setSurahs] = useState<SurahRef[]>([])

  const [selectedStudent, setSelectedStudent] = useState<RosterStudent | null>(null)
  const [history, setHistory] = useState<QuranProgress[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const [surahNum, setSurahNum] = useState(1)
  const [ayahFrom, setAyahFrom] = useState(1)
  const [ayahTo, setAyahTo] = useState(1)
  const [quality, setQuality] = useState<QuranQuality>('mumtaz')
  const [tajweedNotes, setTajweedNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [queued, setQueued] = useState(false)
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
    setSaved(false)
    setError(null)
    setQueued(false)
    setHistoryLoading(true)
    fetchQuranHistory(student.id)
      .then((data) => {
        setHistory(data)
        const latest = data[0]
        setSurahNum(latest?.surah_num ?? 1)
        setAyahFrom(1)
        setAyahTo(latest?.ayah_to ?? 1)
        setQuality('mumtaz')
        setTajweedNotes('')
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setHistoryLoading(false))
  }

  async function handleSave() {
    if (!selectedStudent || !profile) return
    setSaving(true)
    setError(null)
    setQueued(false)
    // A fresh client-generated key, reused both as the offline queue
    // payload's idempotency key (migration 015's `client_ref` unique
    // constraint) and as the optimistic history row's `id` below — one
    // uuid rather than a second one just for display.
    const clientRef = crypto.randomUUID()
    const row: TablesInsert<'quran_progress'> = {
      student_id: selectedStudent.id,
      tutor_id: profile.id,
      surah_num: surahNum,
      ayah_from: ayahFrom,
      ayah_to: ayahTo,
      quality,
      tajweed_notes: tajweedNotes || null,
      client_ref: clientRef,
    }
    try {
      const created = await insertQuranProgress(row)
      setHistory((prev) => [created, ...prev])
      setSaved(true)
    } catch (err) {
      if (!isNetworkError(err)) {
        setError(getErrorMessage(err))
        setSaving(false)
        return
      }
      await offlineQueue.enqueue('quran', row)
      const optimistic: QuranProgress = {
        id: clientRef,
        client_ref: clientRef,
        recorded_at: new Date().toISOString(),
        student_id: row.student_id,
        tutor_id: row.tutor_id,
        surah_num: row.surah_num,
        ayah_from: row.ayah_from,
        ayah_to: row.ayah_to,
        quality: row.quality,
        tajweed_notes: row.tajweed_notes ?? null,
      }
      setHistory((prev) => [optimistic, ...prev])
      setQueued(true)
    }
    setTajweedNotes('')
    setSaving(false)
  }

  if (classesLoading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (classes.length === 0) return <p className="text-ppme-text/60">{t('common.noClassesAssigned')}</p>

  if (!selectedStudent) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold text-ppme-primary">{t('quran.title')}</h1>

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
      {queued && (
        <p className="rounded-lg bg-ppme-primary/10 p-3 text-sm text-ppme-primary">{t('common.offline')}</p>
      )}

      {historyLoading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : (
        <CurrentPositionCard latest={history[0] ?? null} surahs={surahs} titleKey="quran.currentPosition" />
      )}

      <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        {saved && (
          <p className="rounded-lg bg-ppme-success/10 p-3 text-sm font-medium text-ppme-success">
            {t('quran.savedMessage')}
          </p>
        )}

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
          {t('quran.fieldQuality')}
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as QuranQuality)}
            className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
          >
            {QUALITY_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t(QUALITY_LABEL_KEY[opt])}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-medium text-ppme-text/70">
          {t('quran.tajweedNotes')}
          <textarea
            value={tajweedNotes}
            onChange={(e) => setTajweedNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5 text-sm text-ppme-text"
          />
        </label>

        <button
          type="button"
          disabled={saving || ayahFrom < 1 || ayahTo < ayahFrom || ayahTo > currentAyahCount}
          onClick={() => void handleSave()}
          className="min-h-11 w-full rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
        >
          {saving ? t('common.loading') : t('quran.record')}
        </button>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ppme-text/70">{t('quran.history')}</h3>
        <QuranTimeline entries={history} surahs={surahs} />
      </div>
    </div>
  )
}
