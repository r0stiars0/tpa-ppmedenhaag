import { useTranslation } from 'react-i18next'

/**
 * Shown on the family Yanbu'a, Al-Quran and Murajaah screens for a child
 * who is in no group that records them — typically an Aqidah-only child
 * (PRD Feature 8 FR-007) — instead of an empty history.
 */
export function NoTrackingNotice() {
  const { t } = useTranslation()
  return (
    <p className="rounded-lg bg-white p-4 text-center text-sm text-ppme-text/70 shadow-sm">
      {t('common.noTrackingGroup')}
    </p>
  )
}
