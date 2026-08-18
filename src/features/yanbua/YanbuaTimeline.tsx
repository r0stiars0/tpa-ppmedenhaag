import { useTranslation } from 'react-i18next'
import type { YanbuaProgress } from './api'
import { MASTERY_BADGE_CLASS, MASTERY_LABEL_KEY } from './mastery'

export function YanbuaTimeline({ entries }: { entries: YanbuaProgress[] }) {
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
              {t('yanbua.jilid', { number: entry.jilid })} · {t('common.page')} {entry.page}
            </p>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${MASTERY_BADGE_CLASS[entry.mastery]}`}>
              {t(MASTERY_LABEL_KEY[entry.mastery])}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-ppme-text/60">{dateFormatter.format(new Date(entry.recorded_at))}</p>
          {entry.notes && <p className="mt-1 text-sm text-ppme-text/70">{entry.notes}</p>}
        </li>
      ))}
    </ul>
  )
}
