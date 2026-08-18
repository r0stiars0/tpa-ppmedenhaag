import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables } from './database.types'
import type { RecipientRelationships } from './notificationRecipients'

type UserRole = Database['public']['Enums']['user_role']

/**
 * What a signed-in person can actually do, derived from the
 * relationships they hold rather than from the single `users.role`
 * column (TAD ADR-019).
 *
 * `users.role` holds one value, but a real person at the TPA can be
 * several things at once — a tutor whose own child attends, an admin who
 * also teaches a class. The database has always allowed that state:
 * `students.parent_id` is a plain FK to `users(id)` with no role
 * constraint, and every family/tutor policy in migration 003 is written
 * against a relationship (`parent_id = auth.uid()`, `auth.uid() =
 * any(tutor_ids)`, `user_id = auth.uid()`) rather than against the role
 * column. `fn_is_admin()` is the single exception in all 42 policies.
 * Postgres ORs permissive policies, so such a person already gets the
 * union of both grants — proven, not assumed, by RLS-28…RLS-33.
 *
 * These four booleans are the application-layer mirror of exactly those
 * four predicates, and they are deliberately *not* an authorization
 * boundary: they decide which screens are worth offering, while RLS
 * decides what data comes back. A capability that said yes where RLS
 * says no produces an empty screen, never a leak.
 */
export interface Capabilities extends RecipientRelationships {
  /** Has at least one child enrolled — `fn_my_children()` is non-empty. */
  isParentOfAnyone: boolean
  /** Is named in at least one class's `tutor_ids` — `fn_my_classes()` is non-empty. */
  isTutorOfAnyClass: boolean
  /** Is a 16+ student with their own login — `fn_my_student_id()` is set. */
  isSelfStudent: boolean
  /**
   * Holds the admin role. The one capability that is still a role check,
   * because `fn_is_admin()` is: ADR-014's super admin is a granted
   * position, not a relationship anyone can be in by having a child
   * enrolled.
   */
  isAdmin: boolean
}

export const NO_CAPABILITIES: Capabilities = {
  isParentOfAnyone: false,
  isTutorOfAnyClass: false,
  isSelfStudent: false,
  isAdmin: false,
}

/**
 * The students a person is *family* to: their own children, plus their
 * own record if they are a 16+ self-login student.
 *
 * Both columns are carried so the caller can tell the two links apart —
 * `useMyStudents` only needs the names, but `deriveCapabilities` needs
 * to know which of `isParentOfAnyone` / `isSelfStudent` a row implies.
 */
export type FamilyLink = Pick<Tables<'students'>, 'id' | 'full_name' | 'parent_id' | 'user_id'>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * PostgREST's `or=` takes a filter *expression* as a string, so an id
 * spliced into it is not a bound parameter — a value containing a comma
 * or a parenthesis would change which rows the filter selects. The id
 * here always comes from the Supabase session rather than from anything
 * a user typed, so this is a guard rather than a fix for a live hole,
 * but it is the kind of guard that has to exist before the first caller
 * that forgets where its id came from.
 */
export function familyLinkFilter(userId: string): string {
  if (!UUID_RE.test(userId)) {
    throw new Error(`familyLinkFilter: expected a UUID, got ${JSON.stringify(userId)}`)
  }
  return `parent_id.eq.${userId},user_id.eq.${userId}`
}

/**
 * The explicit relationship query behind "my children".
 *
 * Explicit, and not left to RLS. `students` is readable under four
 * separate permissive policies, and `students_tutor_read` returns the
 * caller's whole class — so an unfiltered `select` means "my children"
 * for a parent and "my class of 25" for anyone who also tutors. The
 * filter below asks the question the screens actually mean, and RLS
 * remains the thing that guarantees no answer can include a family that
 * is not theirs.
 */
export async function fetchFamilyLinks(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<FamilyLink[]> {
  const { data, error } = await client
    .from('students')
    .select('id, full_name, parent_id, user_id')
    .or(familyLinkFilter(userId))
    .order('full_name')
  if (error) throw error
  return data ?? []
}

/**
 * The two *family* relationships, read off a set of student rows.
 *
 * Split out of `deriveCapabilities` because these two — and only these
 * two — are also the notification recipient rule (ADR-022), which a
 * Netlify Function has to be able to answer with a service-role client
 * and no React around it. One implementation, so the settings screen and
 * `push-subscribe` cannot come to different conclusions about the same
 * account; `canReceiveNotifications` in `notificationRecipients.ts` is
 * the predicate over the result.
 */
export function familyRelationships(
  userId: string,
  familyLinks: readonly Pick<FamilyLink, 'parent_id' | 'user_id'>[],
): RecipientRelationships {
  return {
    isParentOfAnyone: familyLinks.some((s) => s.parent_id === userId),
    isSelfStudent: familyLinks.some((s) => s.user_id === userId),
  }
}

/**
 * The relationship half of `fetchFamilyLinks`, selecting the two link
 * columns and nothing else.
 *
 * A separate query rather than a reuse of `fetchFamilyLinks` because the
 * caller that needs it — `push-subscribe`, deciding whether to store a
 * push endpoint — has no business reading a list of children's names to
 * answer a yes/no question. Data minimisation applies to what a Function
 * loads into memory, not only to what it sends.
 */
export async function fetchFamilyRelationships(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<RecipientRelationships> {
  const { data, error } = await client
    .from('students')
    .select('parent_id, user_id')
    .or(familyLinkFilter(userId))
  if (error) throw error
  return familyRelationships(userId, data ?? [])
}

/**
 * Whether the caller is named in any class's `tutor_ids`.
 *
 * `contains` compiles to PostgREST's `cs.{…}` — the `@>` array operator,
 * which for a one-element array is the same test `fn_my_classes()` makes
 * with `auth.uid() = any (tutor_ids)`, and which uses the GIN index
 * migration 002 puts on that column. It cannot be replaced by "count the
 * classes RLS returns": `classes_read` also returns the classes a
 * caller's *children* are in, and every class at all to an admin.
 */
export async function fetchTutorClassCount(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<number> {
  const { count, error } = await client
    .from('classes')
    .select('id', { count: 'exact', head: true })
    .contains('tutor_ids', [userId])
  if (error) throw error
  return count ?? 0
}

/**
 * The classes a tutor screen means by "my classes": the ones the caller
 * is actually named in, or every class when the caller is an admin
 * (ADR-014 — an admin manages the whole TPA, and the tutor shape is the
 * one they are routed into).
 *
 * The tutor-side mirror of `fetchFamilyLinks`, and explicit for the same
 * reason. `classes_read` is one policy with four OR-ed branches, and one
 * of them is "the classes my children are in" — so for a tutor who is
 * also a parent an unfiltered `select` returns their own class *plus*
 * the class their child attends, and the ClassPicker offers a class they
 * do not teach. Picking it is a dead end in a way that reads as a bug:
 * `students_tutor_read` is scoped to `fn_my_classes()`, so the roster
 * comes back holding their own child alone, and `sessions_tutor_rw`
 * and `attendance_tutor_insert` check the same function, so recording
 * against it fails with a policy error at save time.
 */
export type TaughtClass = Pick<Tables<'classes'>, 'id' | 'name' | 'schedule'>

export async function fetchTaughtClasses(
  client: SupabaseClient<Database>,
  userId: string,
  options: { isAdmin: boolean },
): Promise<TaughtClass[]> {
  const base = client.from('classes').select('id, name, schedule')
  const { data, error } = await (options.isAdmin ? base : base.contains('tutor_ids', [userId])).order(
    'name',
  )
  if (error) throw error
  return data ?? []
}

/**
 * The pure half: relationships in, capabilities out. Kept separate from
 * the queries so the derivation rules are testable without a database,
 * and so there is one place to read what each capability means.
 */
export function deriveCapabilities(input: {
  userId: string
  role: UserRole | null
  familyLinks: FamilyLink[]
  tutorClassCount: number
}): Capabilities {
  const { userId, role, familyLinks, tutorClassCount } = input
  return {
    ...familyRelationships(userId, familyLinks),
    isTutorOfAnyClass: tutorClassCount > 0,
    isAdmin: role === 'admin',
  }
}

/**
 * The caller's **own** `students` record, when they are a 16+ santri
 * with a self-login — the app-side reading of `fn_my_student_id()`.
 *
 * Carried beside the capabilities rather than folded into them because
 * it is an id, not a permission: `isSelfStudent` answers "may this
 * person be shown the family screens", and this answers "which single
 * row on a class roster is theirs". The recording screens need the
 * second question answered to keep ADR-023's exclusion (`roster.ts`),
 * and a boolean cannot answer it.
 *
 * Null for everybody else, which is every account in the TPA today
 * except Aisyah's — and `isRecordableStudent` is a plain inequality, so
 * null costs those accounts nothing.
 */
export function selfStudentId(
  userId: string,
  familyLinks: readonly Pick<FamilyLink, 'id' | 'user_id'>[],
): string | null {
  return familyLinks.find((student) => student.user_id === userId)?.id ?? null
}

/**
 * Whether a student a screen is currently showing *is* the viewer.
 *
 * The family screens used to ask this as `profile.role === 'parent'`,
 * which is a question about the account and not about the student in
 * front of them. It gave the right answer for every account that could
 * exist before ADR-025 and the wrong one immediately afterwards: an
 * ustadzah whose `users.role` says `tutor` reaching her own son's
 * screens would have been shown "my progress" about him and refused the
 * control to confirm his home practice — a refusal the database does
 * not make (RLS-19; ADR-019 asserts a tutor-parent *can* confirm for
 * their own child and cannot for a pupil).
 *
 * Asked per student instead, one comparison answers it for every
 * combination, including the account that is both a parent and a 16+
 * santri: their own row is theirs, their children's rows are not.
 */
export function isSelfRecord(studentId: string | null, selfStudentId: string | null): boolean {
  return studentId !== null && studentId === selfStudentId
}

/**
 * Everything the screens derive from the two relationship queries: what
 * this person may be offered, and which roster row is their own.
 */
export interface ViewerRelationships {
  capabilities: Capabilities
  selfStudentId: string | null
}

export async function fetchViewerRelationships(
  client: SupabaseClient<Database>,
  userId: string,
  role: UserRole | null,
): Promise<ViewerRelationships> {
  const [familyLinks, tutorClassCount] = await Promise.all([
    fetchFamilyLinks(client, userId),
    fetchTutorClassCount(client, userId),
  ])
  return {
    capabilities: deriveCapabilities({ userId, role, familyLinks, tutorClassCount }),
    selfStudentId: selfStudentId(userId, familyLinks),
  }
}
