import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Database } from '../../lib/database.types'
import { getErrorMessage } from '../../lib/errors'
import { ProgressEditRefusedError } from '../../lib/progressEdit'
import { pageRangeForJilid, type JilidRef } from '../../lib/yanbua'
import type { YanbuaEdit, YanbuaProgress } from './api'
import { MASTERY_LABEL_KEY, MASTERY_OPTIONS } from './mastery'

type YanbuahMastery = Database['public']['Enums']['yanbuah_mastery']

/** Correct a recorded Yanbu'a entry in place (ADR-045). Online only. */
export function YanbuaEditForm({
  entry,
  jilidRefs,
  onSave,
  onCancel,
}: {
  entry: YanbuaProgress
  jilidRefs: JilidRef[]
  onSave: (patch: YanbuaEdit) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [jilid, setJilid] = useState(entry.jilid)
  const [page, setPage] = useState<number | ''>(entry.page)
  const [mastery, setMastery] = useState<YanbuahMastery>(entry.mastery)
  const [notes, setNotes] = useState(entry.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pages run continuously across the whole book (ADR-047), so the valid
  // range is the jilid's own slice of it, not 1..page_count.
  const pageRange = useMemo(() => pageRangeForJilid(jilid, jilidRefs), [jilid, jilidRefs])
  const pageValid = page !== '' && !!pageRange && page >= pageRange.start && page <= pageRange.end

  async function submit() {
    if (page === '') return
    setSaving(true)
    setError(null)
    try {
      await onSave({ jilid, page, mastery, notes: notes || null })
    } catch (err) {
      setError(err instanceof ProgressEditRefusedError ? t('common.editRefused') : getErrorMessage(err))
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-ppme-text/70">
          {t('yanbua.fieldJilid')}
          <select
            value={jilid}
            onChange={(e) => {
              const next = Number(e.target.value)
              setJilid(next)
              // Keep the page inside the new jilid's slice of the book.
              const range = pageRangeForJilid(next, jilidRefs)
              if (range) setPage(range.start)
            }}
            className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
          >
            {(jilidRefs.length > 0 ? jilidRefs.map((r) => r.jilid) : [0, 1, 2, 3, 4, 5, 6, 7]).map((n) => (
              <option key={n} value={n}>
                {n === 0 ? t('yanbua.jilidPemula') : t('yanbua.jilid', { number: n })}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-ppme-text/70">
          {t('yanbua.fieldPage')}
          <input
            type="number"
            min={pageRange?.start ?? 1}
            max={pageRange?.end}
            value={page}
            onChange={(e) => setPage(e.target.value === '' ? '' : Number(e.target.value))}
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
          {MASTERY_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {t(MASTERY_LABEL_KEY[m])}
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
      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving || !pageValid}
          onClick={() => void submit()}
          className="min-h-11 flex-1 rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
        >
          {saving ? t('common.loading') : t('common.save')}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="min-h-11 rounded-lg border border-black/10 px-4 text-sm font-medium text-ppme-text"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
