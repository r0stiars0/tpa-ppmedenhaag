import { useViewScope } from '../../context/ViewScopeContext'
import { TutorAttendanceView } from './TutorAttendanceView'
import { FamilyAttendanceView } from './FamilyAttendanceView'

export function AttendancePage() {
  const { scope } = useViewScope()

  // Which shape renders is the scope, not the role column (ADR-025).
  // The two things that were true before this change are still true:
  //
  //   - an admin takes the *class* shape. `isAdmin` grants that scope
  //     directly, and `useMyClasses` returns every class for an admin,
  //     which is where its own admin branch comes from (ADR-019) — an
  //     admin is normally in no class's `tutor_ids` and the tutor query
  //     alone would leave them with an empty picker.
  //   - the family shape is the wrong *job* for an admin, and that is
  //     the only reason left to keep them out of it by default. It used
  //     to be a safety measure too: `FamilyAttendanceView`'s "my
  //     children" query ran unfiltered and `students_admin_all` has no
  //     `parent_id` predicate, so it would have returned every student
  //     in the school — a ChildPicker listing ~200 children as the
  //     admin's own. ADR-019 closed that at the query (`useMyStudents`
  //     filters on `parent_id`/`user_id` explicitly), so an admin who
  //     reaches this view sees only their own children, or none.
  //
  // What changes is that an admin whose own child is enrolled — like
  // Ustadzah Laila in the dev fixture — is no longer *fenced out* of the
  // family shape by a role label. She holds the family relationship, the
  // switch offers it, and what she gets is her own daughter and nobody
  // else, because the query asks about `parent_id` and RLS answers the
  // same way. Routing has not stood between an admin and the whole
  // school since ADR-019, so there is nothing left for it to protect.
  //
  // ── The heading moved into the two views ────────────────────────────
  // It used to be rendered here, as `attendance.title` for the class
  // scope and `attendance.myTitle` for the family one — and "my
  // attendance" is wrong for a parent, who is looking at their child's.
  // Ibu Siti opened this screen to read "Kehadiranku" above Ali's
  // record. A page cannot fix that: which child is on screen is not
  // known until one is picked, and it is picked inside the view. So
  // this page now only chooses the shape, and each view names itself —
  // the arrangement the other five two-shaped screens already use, and
  // for exactly this reason (see `QuranPage`).
  return scope === 'class' ? <TutorAttendanceView /> : <FamilyAttendanceView />
}
