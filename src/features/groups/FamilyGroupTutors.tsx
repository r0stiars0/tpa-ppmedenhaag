import { useViewScope } from '../../context/ViewScopeContext'
import { useMyStudents } from '../../hooks/useMyStudents'
import { firstName } from '../../lib/notificationCopy'
import { hasFamilyScope } from '../../lib/viewScope'
import { GroupTutorsHeader } from './GroupTutorsHeader'

/**
 * The Dashboard's version of the group-tutor header (ADR-050(c)): it has
 * no child picker, so one block per child. Gated on the family
 * relationship, not the scope switch — the same rule `WeeklySummary`
 * follows — so a tutor-parent sees their own children here whichever
 * shape the feature screens are in, and a tutor or admin with no
 * children sees nothing.
 */
export function FamilyGroupTutors() {
  const { capabilities } = useViewScope()
  const { students, loading } = useMyStudents()
  if (!hasFamilyScope(capabilities) || loading) return null
  return (
    <div className="space-y-2">
      {students.map((s) => (
        <GroupTutorsHeader
          key={s.id}
          studentId={s.id}
          kind="all"
          heading={students.length > 1 ? firstName(s.full_name) : undefined}
        />
      ))}
    </div>
  )
}
