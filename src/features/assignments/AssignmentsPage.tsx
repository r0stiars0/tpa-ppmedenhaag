import { useViewScope } from '../../context/ViewScopeContext'
import { TutorAssignmentsView } from './TutorAssignmentsView'
import { FamilyAssignmentsView } from './FamilyAssignmentsView'

// Same shape as YanbuaPage: the heading lives inside each view rather
// than here, since the family view's title depends on whether the
// viewer is a parent (assignments.childTitle, needs the selected
// child's name) or a 16+ student (assignments.myTitle) — not known
// until a child is picked.
//
// Which view renders is `useViewScope`, not `profile.role` (ADR-025).
// For an admin the answer is unchanged — `isAdmin` grants the class
// scope, and admin has no family scope unless their own child is
// enrolled, in which case the switch offers it and defaults to the
// class shape. For a tutor-parent both scopes exist and the person
// chooses; for everyone holding one relationship `availableScopes` has
// a single member and this line resolves to exactly what it resolved to
// before.
export function AssignmentsPage() {
  const { scope } = useViewScope()
  return scope === 'class' ? <TutorAssignmentsView /> : <FamilyAssignmentsView />
}
