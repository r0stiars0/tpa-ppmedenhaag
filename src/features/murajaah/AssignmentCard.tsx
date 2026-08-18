import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { findSurah, type SurahRef } from '../../lib/quran'
import { FREQUENCY_LABEL_KEY } from '../../lib/murajaah'
import type { MurajaahAssignment } from './api'

interface AssignmentCardProps {
  assignment: MurajaahAssignment
  surahs: SurahRef[]
  children?: ReactNode
}

/**
 * Displays one Murajaah target (surah, ayah range, frequency). Used both
 * by the tutor's assign/portfolio views and the family view's current
 * target card — `children` is the slot for the role-specific action
 * (tutor: "mark memorized"; parent: streak + confirm button).
 */
export function AssignmentCard({ assignment, surahs, children }: AssignmentCardProps) {
  const { t } = useTranslation()
  const surah = findSurah(assignment.surah_num, surahs)

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold text-ppme-primary">
            {surah?.transliteration ?? t('quran.surahNumber', { number: assignment.surah_num })}
          </p>
          <p className="text-sm text-ppme-text/70">
            {t('common.ayah')} {assignment.ayah_from}–{assignment.ayah_to}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-ppme-bg-alt px-3 py-1 text-xs font-semibold text-ppme-text/70">
          {t(FREQUENCY_LABEL_KEY[assignment.frequency])}
        </span>
      </div>
      {children && <div className="mt-3 border-t border-black/5 pt-3">{children}</div>}
    </div>
  )
}
