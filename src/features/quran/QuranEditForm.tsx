import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Database } from '../../lib/database.types'
import { getErrorMessage } from '../../lib/errors'
import { ProgressEditRefusedError } from '../../lib/progressEdit'
import type { SurahRef } from '../../lib/quran'
import type { QuranEdit, QuranProgress } from './api'
import { QUALITY_LABEL_KEY, QUALITY_OPTIONS } from './quality'
import { SurahSelect } from './SurahSelect'

type QuranQuality = Database['public']['Enums']['quran_quality']

/** Correct a recorded Quran entry in place (ADR-045). Online only. */
export function QuranEditForm({
  entry,
  surahs,
  onSave,
  onCancel,
}: {
  entry: QuranProgress
  surahs: SurahRef[]
  onSave: (patch: QuranEdit) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [surahNum, setSurahNum] = useState(entry.surah_num)
  const [ayahFrom, setAyahFrom] = useState<number | ''>(entry.ayah_from)
  const [ayahTo, setAyahTo] = useState<number | ''>(entry.ayah_to)
  const [quality, setQuality] = useState<QuranQuality>(entry.quality)
  const [notes, setNotes] = useState(entry.tajweed_notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ayahCount = surahs.find((s) => s.surah_num === surahNum)?.ayah_count ?? 286

  async function submit() {
    if (ayahFrom === '' || ayahTo === '') return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        surah_num: surahNum,
        ayah_from: ayahFrom,
        ayah_to: ayahTo,
        quality,
        tajweed_notes: notes || null,
      })
    } catch (err) {
      setError(err instanceof ProgressEditRefusedError ? t('common.editRefused') : getErrorMessage(err))
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <SurahSelect surahs={surahs} value={surahNum} onChange={setSurahNum} />
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-ppme-text/70">
          {t('common.ayah')} {t('common.from')}
          <input
            type="number"
            min={1}
            max={ayahCount}
            value={ayahFrom}
            onChange={(e) => setAyahFrom(e.target.value === '' ? '' : Number(e.target.value))}
            className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
          />
        </label>
        <label className="text-xs font-medium text-ppme-text/70">
          {t('common.ayah')} {t('common.to')}
          <input
            type="number"
            min={1}
            max={ayahCount}
            value={ayahTo}
            onChange={(e) => setAyahTo(e.target.value === '' ? '' : Number(e.target.value))}
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
          disabled={saving || ayahFrom === '' || ayahTo === '' || ayahFrom < 1 || ayahTo < ayahFrom || ayahTo > ayahCount}
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
