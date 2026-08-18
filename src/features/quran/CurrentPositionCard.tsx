import { useTranslation } from 'react-i18next'
import { computeQuranPercent, findSurah, type SurahRef } from '../../lib/quran'
import type { QuranProgress } from './api'
import { QUALITY_BADGE_CLASS, QUALITY_LABEL_KEY } from './quality'

interface CurrentPositionCardProps {
  latest: QuranProgress | null
  surahs: SurahRef[]
  titleKey: string
}

export function CurrentPositionCard({ latest, surahs, titleKey }: CurrentPositionCardProps) {
  const { t, i18n } = useTranslation()
  const dateFormatter = new Intl.DateTimeFormat(i18n.language === 'nl' ? 'nl-NL' : 'id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-ppme-text/50">{t(titleKey)}</p>
      {!latest ? (
        <p className="mt-2 text-ppme-text/60">{t('common.empty')}</p>
      ) : (
        <>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="text-2xl font-bold text-ppme-primary">
              {findSurah(latest.surah_num, surahs)?.transliteration ??
                t('quran.surahNumber', { number: latest.surah_num })}
            </p>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${QUALITY_BADGE_CLASS[latest.quality]}`}>
              {t(QUALITY_LABEL_KEY[latest.quality])}
            </span>
          </div>
          <p className="mt-1 text-sm text-ppme-text/70">
            {t('common.ayah')} {latest.ayah_to}
          </p>
          {surahs.length > 0 && (
            <p className="mt-1 text-sm text-ppme-text/70">
              {t('quran.percentQuran', { percent: computeQuranPercent(latest.surah_num, latest.ayah_to, surahs) })}
            </p>
          )}
          <p className="mt-2 text-xs text-ppme-text/50">
            {t('quran.lastSession')}: {dateFormatter.format(new Date(latest.recorded_at))}
          </p>
        </>
      )}
    </div>
  )
}
