import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TutorAssignView } from './TutorAssignView'
import { TutorOverviewView } from './TutorOverviewView'

type Tab = 'assign' | 'overview'

/**
 * Tutor gets two screens for Murajaah, unlike the single roster-drill-down
 * shape used by Yanbu'a/Quran: FR-001/FR-005/FR-007 (assign a target,
 * mark memorized) need the per-student drill-down (TutorAssignView),
 * while FR-004 (class-wide "who has/hasn't confirmed" view) needs the
 * whole-roster-at-once shape from TutorAttendanceView (TutorOverviewView).
 */
export function TutorMurajaahView() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('assign')

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-ppme-primary">{t('murajaah.title')}</h1>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('assign')}
          className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors ${
            tab === 'assign' ? 'bg-ppme-primary text-white' : 'bg-white text-ppme-text/60 shadow-sm'
          }`}
        >
          {t('murajaah.tabAssign')}
        </button>
        <button
          type="button"
          onClick={() => setTab('overview')}
          className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors ${
            tab === 'overview' ? 'bg-ppme-primary text-white' : 'bg-white text-ppme-text/60 shadow-sm'
          }`}
        >
          {t('murajaah.tabOverview')}
        </button>
      </div>

      {tab === 'assign' ? <TutorAssignView /> : <TutorOverviewView />}
    </div>
  )
}
