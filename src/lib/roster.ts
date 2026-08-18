import { supabase } from './supabase'
import { isSelfRecord } from './capabilities'

export interface RosterStudent {
  id: string
  full_name: string
}

/** Students in a tutor/admin's class — RLS scopes this via `fn_my_classes()`. */
export async function fetchClassRoster(classId: string): Promise<RosterStudent[]> {
  const { data, error } = await supabase
    .from('students')
    .select('id, full_name')
    .eq('class_id', classId)
    .order('full_name')
  if (error) throw error
  return data ?? []
}

/**
 * Whether the caller may record *about* this student — the app-side
 * mirror of `fn_my_recordable_students()` (TAD ADR-023(a)).
 *
 * A 16+ santri who assists the class she is enrolled in has her own
 * record inside her own tutor grant. Migration 013 refuses the
 * evaluative writes for exactly that row, so before this PR the
 * question never arose in the product: routing was `users.role`-shaped
 * and no screen took her to a roster at all (ADR-020(d)). ADR-025
 * removes that accident, and without this predicate her own name would
 * appear on five recording screens where every save returns a policy
 * error — a 403 with a roster row to blame it on.
 *
 * ── The one rule this must never generalise ─────────────────────────
 * `selfStudentId` is the caller's **own** `students` record and nothing
 * else. It is never their child. A tutor who teaches the class her own
 * child attends may record for that child and write her year-end
 * report — PPME's decision, ADR-024, and the whole point of ADR-024(c)
 * is that this case and the student-assistant case look structurally
 * identical and are different in kind. `fn_my_recordable_students()`
 * subtracts `fn_my_student_id()` and never `fn_my_children()`; so does
 * this. Widening it to "anyone I am related to" would quietly forbid
 * the ordinary arrangement at a small TPA, on screens rather than in
 * policies, where no RLS test would catch it.
 */
export function isRecordableStudent(studentId: string, selfStudentId: string | null): boolean {
  return !isSelfRecord(studentId, selfStudentId)
}

export function recordableStudents<T extends { id: string }>(
  roster: readonly T[],
  selfStudentId: string | null,
): T[] {
  return roster.filter((student) => isRecordableStudent(student.id, selfStudentId))
}

/**
 * The roster a recording screen should offer: the class, minus the
 * caller's own record.
 *
 * A named function rather than `recordableStudents(await
 * fetchClassRoster(id), self)` spelled out at each of the six call
 * sites, so that "which roster does this screen mean" is answered where
 * the query is made — the same reasoning `fetchTaughtClasses` and
 * `fetchFamilyLinks` are built on (ADR-019(c)).
 *
 * `fetchClassRoster` stays unfiltered and is still what the attendance
 * register calls, because the assistant has to *appear* on the register
 * — somebody else marks her present, and a roster she is missing from
 * is one nobody is prompted to complete. Attendance excludes her from
 * what it submits instead (ADR-023(c), closed in ADR-025).
 */
export async function fetchRecordableRoster(
  classId: string,
  selfStudentId: string | null,
): Promise<RosterStudent[]> {
  return recordableStudents(await fetchClassRoster(classId), selfStudentId)
}
