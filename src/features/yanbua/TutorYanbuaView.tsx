import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useMyClasses } from '../../hooks/useMyClasses'
import { ClassPicker } from '../../components/ClassPicker'
import { fetchRecordableRoster, type RosterStudent } from '../../lib/roster'
import { useViewScope } from '../../context/ViewScopeContext'
import type { Database, TablesInsert } from '../../lib/database.types'
import { getErrorMessage } from '../../lib/errors'
import { isNetworkError } from '../../lib/network'
import { offlineQueue } from '../../lib/offlineQueue'
import { isJilidComplete, nextJilid, type JilidRef } from '../../lib/yanbua'
import { fetchYanbuaHistory, fetchYanbuaJilidRef, insertYanbuaProgress, type YanbuaProgress } from './api'
import { CurrentLevelCard } from './CurrentLevelCard'
import { YanbuaTimeline } from './YanbuaTimeline'

type YanbuahMastery = Database['public']['Enums']['yanbuah_mastery']

const MASTERY_OPTIONS: { value: YanbuahMastery; labelKey: string }[] = [
  { value: 'lancar', labelKey: 'yanbua.masteryLancar' },
  { value: 'kurang_lancar', labelKey: 'yanbua.masteryKurangLancar' },
  { value: 'ulang', labelKey: 'yanbua.masteryUlang' },
]

export function TutorYanbuaView() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const { classes, loading: classesLoading } = useMyClasses()
  const { selfStudentId } = useViewScope()

  const [classId, setClassId] = useState<string | null>(null)
  const [roster, setRoster] = useState<RosterStudent[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [jilidRefs, setJilidRefs] = useState<JilidRef[]>([])

  const [selectedStudent, setSelectedStudent] = useState<RosterStudent | null>(null)
  const [history, setHistory] = useState<YanbuaProgress[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const [jilid, setJilid] = useState(1)
  const [page, setPage] = useState(1)
  const [mastery, setMastery] = useState<YanbuahMastery>('lancar')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<{ text: string; celebrate: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState(false)

  useEffect(() => {
    fetchYanbuaJilidRef()
      .then(setJilidRefs)
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

  const currentPageCount = useMemo(
    () => jilidRefs.find((r) => r.jilid === jilid)?.page_count ?? 44,
    [jilidRefs, jilid],
  )

  function openStudent(student: RosterStudent) {
    setSelectedStudent(student)
    setBanner(null)
    setError(null)
    setQueued(false)
    setHistoryLoading(true)
    fetchYanbuaHistory(student.id)
      .then((data) => {
        setHistory(data)
        const latest = data[0]
        setJilid(latest?.jilid ?? 1)
        setPage(latest?.page ?? 1)
        setMastery('lancar')
        setNotes('')
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
    // constraint) and as the optimistic history row's `id` below —
    // one uuid rather than a second one just for display.
    const clientRef = crypto.randomUUID()
    const row: TablesInsert<'yanbua_progress'> = {
      student_id: selectedStudent.id,
      tutor_id: profile.id,
      jilid,
      page,
      mastery,
      notes: notes || null,
      client_ref: clientRef,
    }
    try {
      const created = await insertYanbuaProgress(row)
      setHistory((prev) => [created, ...prev])
    } catch (err) {
      if (!isNetworkError(err)) {
        setError(getErrorMessage(err))
        setSaving(false)
        return
      }
      await offlineQueue.enqueue('yanbua', row)
      // No server-returned row to prepend, so a local stand-in is shown
      // instead. The jilid-complete banner below runs entirely off
      // local state (jilid/page/mastery/jilidRefs), so it needs nothing
      // beyond what the insert itself would have returned.
      const optimistic: YanbuaProgress = {
        id: clientRef,
        client_ref: clientRef,
        recorded_at: new Date().toISOString(),
        student_id: row.student_id,
        tutor_id: row.tutor_id,
        jilid: row.jilid,
        page: row.page,
        mastery: row.mastery,
        notes: row.notes ?? null,
      }
      setHistory((prev) => [optimistic, ...prev])
      setQueued(true)
    }

    if (isJilidComplete(jilid, page, mastery, jilidRefs)) {
      setBanner({ text: t('yanbua.jilidComplete', { number: jilid }), celebrate: true })
      const next = nextJilid(jilid)
      if (next) {
        setJilid(next)
        setPage(1)
      }
    } else {
      setBanner({ text: t('yanbua.savedMessage'), celebrate: false })
    }
    setNotes('')
    setSaving(false)
  }

  if (classesLoading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (classes.length === 0) return <p className="text-ppme-text/60">{t('common.noClassesAssigned')}</p>

  if (!selectedStudent) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold text-ppme-primary">{t('yanbua.title')}</h1>

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
        <CurrentLevelCard latest={history[0] ?? null} jilidRefs={jilidRefs} titleKey="yanbua.currentLevel" />
      )}

      <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        {banner && (
          <p
            className={`rounded-lg p-3 text-sm font-medium ${
              banner.celebrate
                ? 'bg-ppme-accent/15 text-ppme-primary'
                : 'bg-ppme-success/10 text-ppme-success'
            }`}
          >
            {banner.text}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-ppme-text/70">
            {t('yanbua.fieldJilid')}
            <select
              value={jilid}
              onChange={(e) => setJilid(Number(e.target.value))}
              className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
            >
              {(jilidRefs.length > 0 ? jilidRefs.map((r) => r.jilid) : [1, 2, 3, 4, 5, 6, 7]).map((n) => (
                <option key={n} value={n}>
                  {t('yanbua.jilid', { number: n })}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-ppme-text/70">
            {t('yanbua.fieldPage')}
            <input
              type="number"
              min={1}
              max={currentPageCount}
              value={page}
              onChange={(e) => setPage(Number(e.target.value))}
              className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
            />
          </label>
        </div>

        <label className="block text-xs font-medium text-ppme-text/70">
          {t('yanbua.fieldMastery')}
          <select
            value={mastery}
            onChange={(e) => setMastery(e.target.value as YanbuahMastery)}
            className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
          >
            {MASTERY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-medium text-ppme-text/70">
          {t('yanbua.notes')}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1.5 text-sm text-ppme-text"
          />
        </label>

        <button
          type="button"
          disabled={saving || page < 1 || page > currentPageCount}
          onClick={() => void handleSave()}
          className="min-h-11 w-full rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
        >
          {saving ? t('common.loading') : t('yanbua.record')}
        </button>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ppme-text/70">{t('yanbua.sessionHistory')}</h3>
        <YanbuaTimeline entries={history} />
      </div>
    </div>
  )
}
