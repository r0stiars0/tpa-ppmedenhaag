import { useViewScope } from '../../context/ViewScopeContext'
import { TutorYanbuaView } from './TutorYanbuaView'
import { FamilyYanbuaView } from './FamilyYanbuaView'

// Unlike AttendancePage, the heading lives inside each view rather than
// here: the family view's title depends on whether the viewer is a parent
// (yanbua.childTitle, needs the selected child's name) or a 16+ student
// (yanbua.myTitle) — that distinction isn't known until a child is picked.
//
// Which view renders is `useViewScope`, not `profile.role` (ADR-025).
// For an admin the answer is unchanged — `isAdmin` grants the class
// scope, and admin has no family scope unless their own child is
// enrolled, in which case the switch offers it and defaults to the
// class shape. For a tutor-parent both scopes exist and the person
// chooses; for everyone holding one relationship `availableScopes` has
// a single member and this line resolves to exactly what it resolved to
// before.
// `useMyClasses` still returns every class for an admin (its own branch,
// ADR-019), and recorded rows still carry the recorder's own id in
// `tutor_id` — see AttendancePage/TutorYanbuaView.
export function YanbuaPage() {
  const { scope } = useViewScope()
  return scope === 'class' ? <TutorYanbuaView /> : <FamilyYanbuaView />
}
