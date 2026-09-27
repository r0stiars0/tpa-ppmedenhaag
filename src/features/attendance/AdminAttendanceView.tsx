import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { SegmentedSwitch } from '../../components/SegmentedSwitch'
import { TutorAttendanceOverview } from './TutorAttendanceOverview'
import { TutorAttendanceView } from './TutorAttendanceView'

type AdminView = 'santri' | 'guru'

/**
 * An admin's Attendance screen (TAD ADR-046(d)): "Santri | Guru".
 * Santri is the register exactly as a tutor has it, for any group —
 * including the "Kehadiran guru" block, so an admin covering a session
 * records students and tutors in one place. Guru is the tutor overview,
 * statistics only. The choice lives in `?view=guru` so the old Beheer
 * address can redirect straight to it.
 */
export function AdminAttendanceView() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const view: AdminView = params.get('view') === 'guru' ? 'guru' : 'santri'

  function setView(next: AdminView) {
    setParams(next === 'guru' ? { view: 'guru' } : {}, { replace: true })
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-ppme-primary">{t('attendance.title')}</h1>
      <SegmentedSwitch
        label={t('attendance.viewSwitch')}
        value={view}
        onChange={setView}
        options={[
          { value: 'santri', label: t('attendance.viewStudents') },
          { value: 'guru', label: t('attendance.viewTutors') },
        ]}
      />
      {view === 'guru' ? (
        <TutorAttendanceOverview />
      ) : (
        <TutorAttendanceView heading={false} onShowTutorStats={() => setView('guru')} />
      )}
    </div>
  )
}
