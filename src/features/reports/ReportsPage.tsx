import { useViewScope } from '../../context/ViewScopeContext'
import { TutorReportsView } from './TutorReportsView'
import { FamilyReportsView } from './FamilyReportsView'

/**
 * Same shape as QuranPage/MurajaahPage/YanbuaPage/AssignmentsPage: the
 * scope decides, not the role column (ADR-025). An admin still takes the
 * staff view — `isAdmin` grants the class scope — and a tutor-parent can
 * now reach both, which for this screen is the sharpest case in the app:
 * in the class scope Bapak Hasan writes his own daughter's report and
 * reads it in draft (ADR-024), and in the family scope he sees the
 * published version as her father. Both are correct, and the switch is
 * what makes the difference legible instead of silent.
 *
 * Since ADR-014, admin sees every class's reports including drafts (RLS
 * already returned them — `yer_admin_all`), edits narratives and grades
 * like any other operational data, and downloads the PDFs. Publishing
 * stays with the authoring tutor; `TutorReportsView`/`ReportEditor`
 * carry that distinction. Bulk draft generation, previously a screen of
 * its own at `/admin/reports`, is now a panel inside this view.
 */
export function ReportsPage() {
  const { scope } = useViewScope()
  return scope === 'class' ? <TutorReportsView /> : <FamilyReportsView />
}
