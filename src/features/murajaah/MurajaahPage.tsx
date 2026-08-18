import { useViewScope } from '../../context/ViewScopeContext'
import { TutorMurajaahView } from './TutorMurajaahView'
import { FamilyMurajaahView } from './FamilyMurajaahView'

// Same shape as QuranPage/YanbuaPage/AssignmentsPage: the heading lives
// inside each view, since the family view's title depends on whether the
// viewer is a parent or a 16+ santri — not known until a child is picked.
//
// Which view renders is `useViewScope`, not `profile.role` (ADR-025).
// For an admin the answer is unchanged — `isAdmin` grants the class
// scope, and admin has no family scope unless their own child is
// enrolled, in which case the switch offers it and defaults to the
// class shape. For a tutor-parent both scopes exist and the person
// chooses; for everyone holding one relationship `availableScopes` has
// a single member and this line resolves to exactly what it resolved to
// before.
//
// Note this is also where ADR-014's one deliberate exception lands:
// admin can set and deactivate Murajaah targets exactly like a tutor,
// but confirming *home practice* stays with parents. That falls out of
// the view split rather than needing a guard — the confirm control only
// exists in FamilyMurajaahView, gated on `role === 'parent'`, and
// `murajaah_log.confirmed_by` means "the parent who watched the child
// recite", which is not something an administrator can witness.
export function MurajaahPage() {
  const { scope } = useViewScope()
  return scope === 'class' ? <TutorMurajaahView /> : <FamilyMurajaahView />
}
