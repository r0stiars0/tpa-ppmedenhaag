import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SurahRef } from '../../lib/quran'

interface SurahSelectProps {
  surahs: SurahRef[]
  value: number
  onChange: (surahNum: number) => void
}

/**
 * PRD FR-001 asks for "Surah (dropdown/search)". Rather than pull in a
 * combobox library for a single field, this pairs a plain text filter
 * with a native `<select>` — the select always keeps the current value
 * as an option (even if it doesn't match the filter) so typing never
 * silently changes the selection out from under the tutor.
 */
export function SurahSelect({ surahs, value, onChange }: SurahSelectProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = q
      ? surahs.filter(
          (s) => s.transliteration.toLowerCase().includes(q) || String(s.surah_num).includes(q),
        )
      : surahs
    if (matches.some((s) => s.surah_num === value)) return matches
    const selected = surahs.find((s) => s.surah_num === value)
    return selected ? [selected, ...matches] : matches
  }, [surahs, query, value])

  return (
    <label className="block text-xs font-medium text-ppme-text/70">
      {t('quran.fieldSurah')}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('quran.searchSurah')}
        className="mt-1 mb-1 min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
      />
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-h-11 w-full rounded-lg border border-black/10 px-2 text-sm text-ppme-text"
      >
        {filtered.map((s) => (
          <option key={s.surah_num} value={s.surah_num}>
            {s.surah_num}. {s.transliteration}
          </option>
        ))}
      </select>
    </label>
  )
}
