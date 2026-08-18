import { useTranslation } from 'react-i18next'
import type { JilidRef } from '../../lib/yanbua'
import type { YanbuaProgress } from './api'
import { MASTERY_BADGE_CLASS, MASTERY_LABEL_KEY } from './mastery'

interface CurrentLevelCardProps {
  latest: YanbuaProgress | null
  jilidRefs: JilidRef[]
  titleKey: string
}

export function CurrentLevelCard({ latest, jilidRefs, titleKey }: CurrentLevelCardProps) {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-ppme-text/50">{t(titleKey)}</p>
      {!latest ? (
        <p className="mt-2 text-ppme-text/60">{t('common.empty')}</p>
      ) : (
        <>
          <div className="mt-1 flex items-baseline justify-between">
            <p className="text-2xl font-bold text-ppme-primary">{t('yanbua.jilid', { number: latest.jilid })}</p>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${MASTERY_BADGE_CLASS[latest.mastery]}`}>
              {t(MASTERY_LABEL_KEY[latest.mastery])}
            </span>
          </div>
          <p className="mt-1 text-sm text-ppme-text/70">
            {t('yanbua.pageOf', {
              page: latest.page,
              total: jilidRefs.find((r) => r.jilid === latest.jilid)?.page_count ?? '?',
            })}
          </p>
        </>
      )}
    </div>
  )
}
