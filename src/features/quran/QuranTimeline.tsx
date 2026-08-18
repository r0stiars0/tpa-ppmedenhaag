import { useTranslation } from 'react-i18next'
import { findSurah, type SurahRef } from '../../lib/quran'
import type { QuranProgress } from './api'
import { QUALITY_BADGE_CLASS, QUALITY_LABEL_KEY } from './quality'

export function QuranTimeline({ entries, surahs }: { entries: QuranProgress[]; surahs: SurahRef[] }) {
  const { t, i18n } = useTranslation()
  const dateFormatter = new Intl.DateTimeFormat(i18n.language === 'nl' ? 'nl-NL' : 'id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  if (entries.length === 0) return <p className="text-ppme-text/60">{t('common.empty')}</p>

  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-lg bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ppme-text">
              {findSurah(entry.surah_num, surahs)?.transliteration ??
                t('quran.surahNumber', { number: entry.surah_num })}{' '}
              · {t('common.ayah')} {entry.ayah_from}–{entry.ayah_to}
            </p>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${QUALITY_BADGE_CLASS[entry.quality]}`}>
              {t(QUALITY_LABEL_KEY[entry.quality])}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-ppme-text/60">{dateFormatter.format(new Date(entry.recorded_at))}</p>
          {entry.tajweed_notes && <p className="mt-1 text-sm text-ppme-text/70">{entry.tajweed_notes}</p>}
        </li>
      ))}
    </ul>
  )
}
