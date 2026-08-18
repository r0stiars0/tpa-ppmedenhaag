import type { Database } from './database.types'

type UserRole = Database['public']['Enums']['user_role']

/**
 * Which accounts an admin may be *offered* when attaching a person to a
 * child's record or to a class (TAD ADR-028).
 *
 * ── What this is not ────────────────────────────────────────────────
 * It is not an authorization boundary, and it is not a policy. The
 * database has never constrained either link: `students.parent_id` is a
 * plain FK to `users(id)` and `classes.tutor_ids` a plain uuid array,
 * both without a role check, which is the fact ADR-019 is built on and
 * RLS-28…RLS-34 pin. Anything reachable through SQL stays reachable;
 * these two lists decide only what a dropdown shows an administrator.
 *
 * That is why the code lives here rather than beside the queries. A
 * capability decides what to offer and RLS decides what comes back
 * (ADR-019(b)), and the same split applies one level up: an enrolment
 * picker decides what to offer and the schema decides what can be
 * stored. Getting it wrong makes a screen unhelpful, never unsafe.
 *
 * ── Why the two lists differ ────────────────────────────────────────
 * Neither is a guess; each follows a decision already recorded.
 *
 * A **tutor** may be a parent — ADR-024 settled that PPME wants a
 * teacher of the class their own child attends, because at a small TPA
 * a teacher teaches their own children. An **admin** may be too;
 * Ustadzah Laila is exactly that. So both belong in the parent list, and
 * their absence is why every multi-relationship account in this project
 * had to be created in SQL (ADR-025(f)).
 *
 * A **santri with their own login may tutor** — ADR-020, and RLS-35
 * pins the grant that follows. Aisyah assists the class she attends.
 * So `student` belongs in the tutor list, and this is the change that
 * finally makes her arrangement reachable through the interface rather
 * than only through a fixture.
 *
 * ── The one deliberate omission ─────────────────────────────────────
 * `student` is **not** offered as a parent. Nothing in the record
 * blesses a 16+ santri as another child's parent, PPME has not asked
 * for it, and attaching a child's whole record to a teenager is the
 * kind of thing that should happen because somebody decided it rather
 * than because a dropdown was sorted alphabetically. The database still
 * permits it; if PPME ever wants it, this is a one-line change and an
 * ADR, which is the right amount of friction for a decision with a
 * DPIA question attached (DPIA R12).
 */
export const PARENT_LINK_ROLES: readonly UserRole[] = ['parent', 'tutor', 'admin']

export const TUTOR_LINK_ROLES: readonly UserRole[] = ['parent', 'tutor', 'admin', 'student']

/** Whether an account holding `role` may be offered as a child's parent contact. */
export function mayBeNamedAsParent(role: UserRole): boolean {
  return PARENT_LINK_ROLES.includes(role)
}

/** Whether an account holding `role` may be offered as a class's tutor. */
export function mayBeNamedAsTutor(role: UserRole): boolean {
  return TUTOR_LINK_ROLES.includes(role)
}

export interface LinkableAccount {
  id: string
  full_name: string
  email: string
  role: UserRole
}

/**
 * The self-login picker's option list when *editing* a student who may
 * already have one linked (TAD ADR-032), as opposed to creating a new
 * student, where the pool needs no adjustment.
 *
 * `unlinked` — role=`student` accounts not yet linked to *any* student
 * — deliberately excludes the account already linked to the row being
 * edited: it is not *available* to link, it is already linked to this
 * one. Without restoring it, the picker would have no option matching
 * the row's current `user_id`, and saving would silently unlink it.
 * `currentlyLinked` is `null` for a student with no self-login yet, in
 * which case the pool passes through unchanged.
 */
export function selfLoginAccountsToOffer(
  unlinked: readonly LinkableAccount[],
  currentlyLinked: Pick<LinkableAccount, 'id' | 'full_name' | 'email'> | null,
): LinkableAccount[] {
  if (!currentlyLinked) return [...unlinked]
  if (unlinked.some((u) => u.id === currentlyLinked.id)) return [...unlinked]
  return [{ ...currentlyLinked, role: 'student' }, ...unlinked]
}
