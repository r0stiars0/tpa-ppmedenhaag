import { supabase } from '../../lib/supabase'
import type { Database, Tables, TablesInsert } from '../../lib/database.types'

type UserRole = Database['public']['Enums']['user_role']

export interface PendingRegistration {
  id: string
  email: string
  created_at: string
  /**
   * The name and free-text context the user submitted from the
   * Unauthorized screen (ADR-038). Both `null` for anyone who reached
   * the pending list without submitting one — an `invite-user` account,
   * or a sign-in predating migration 020.
   */
  full_name: string | null
  description: string | null
}

export async function fetchPendingRegistrations(): Promise<PendingRegistration[]> {
  const { data, error } = await supabase.rpc('fn_pending_registrations')
  if (error) throw error
  return data ?? []
}

export async function registerUser(params: {
  id: string
  email: string
  full_name: string
  role: UserRole
}): Promise<void> {
  const { error } = await supabase.from('users').insert({ ...params, locale: 'id' })
  if (error) throw error
}

/**
 * Invites a new user by email via the invite-user Netlify Function
 * (service-role only — createUser and pre-creating the profile both
 * require bypassing RLS, which the browser client can never do).
 * Collapses the "they sign in once, then an admin notices and registers
 * them" two-step flow into one action; falls back to the existing
 * pending-registrations list if the invite email never arrives and they
 * sign in directly instead.
 */
export async function inviteUser(params: { email: string; full_name: string; role: UserRole }): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch('/.netlify/functions/invite-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(params),
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Invite failed (${res.status})`)
  }
}

/**
 * Rejects a still-pending registration via the reject-registration
 * Netlify Function (TAD ADR-039) — deletes the `auth.users` row the
 * pending state is keyed on. Service-role only, same as inviteUser: the
 * pending list is `auth.users` rows, which the browser client cannot
 * touch. The Function refuses (409) if the id already has a profile, so
 * this can never cascade into a real account.
 */
export async function rejectRegistration(id: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch('/.netlify/functions/reject-registration', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ id }),
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Reject failed (${res.status})`)
  }
}

export interface DirectoryUser {
  id: string
  full_name: string
  email: string
  /**
   * Carried so the picker can *show* it. The role no longer decides
   * whether an account may be linked — see `src/lib/enrolmentLinks.ts`
   * — but an admin choosing between two people called Fatimah is better
   * off knowing which one already teaches.
   */
  role: UserRole
}

/**
 * The accounts an admin may be offered for an enrolment link.
 *
 * Takes a list rather than a single role because both links accept
 * several: a tutor or an admin may be a child's parent (ADR-024), and a
 * 16+ santri may tutor (ADR-020). `in` is one round trip and uses the
 * same index `eq` did.
 *
 * The lists themselves live in `src/lib/enrolmentLinks.ts`, not here:
 * coverage is scoped to `src/lib/**`, so a rule written in this file
 * would be invisible to the gate — the reasoning that put
 * `canReceiveNotifications` in a library (ADR-022(c)) and `viewScope`
 * in another (ADR-025(b)).
 */
export async function fetchUsersForLink(roles: readonly UserRole[]): Promise<DirectoryUser[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role')
    .in('role', roles as UserRole[])
    .order('full_name')
  if (error) throw error
  return data ?? []
}

export type AdminClass = Tables<'classes'>

export async function fetchAllClasses(): Promise<AdminClass[]> {
  const { data, error } = await supabase.from('classes').select('*').order('name')
  if (error) throw error
  return data ?? []
}

export async function createClass(row: TablesInsert<'classes'>): Promise<AdminClass> {
  const { data, error } = await supabase.from('classes').insert(row).select().single()
  if (error) throw error
  return data
}

export async function updateClass(
  id: string,
  patch: Partial<Pick<AdminClass, 'name' | 'schedule' | 'meeting_days' | 'tutor_ids'>>,
): Promise<AdminClass> {
  const { data, error } = await supabase.from('classes').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

/**
 * Every user with a profile, for the admin directory (ADR-042). Reuses
 * `DirectoryUser` — the same `id / full_name / email / role` shape the
 * enrolment pickers already carry. Admin-only in practice: `users_self_read`
 * only returns other rows to an admin.
 */
export async function fetchAllUsers(): Promise<DirectoryUser[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role')
    .order('full_name')
  if (error) throw error
  return data ?? []
}

/** Consequences of a prospective role change (ADR-042), from `fn_admin_user_role_impact`. */
export interface UserRoleImpact {
  /** Groups a tutor→non-tutor change would unassign them from (they get removed). */
  tutorGroups: string[]
  /** Children a parent→non-parent change leaves them guarding — links stay, access is unaffected. */
  guardianChildren: string[]
  /** The santri a student→non-student change leaves this account linked to, or null. */
  linkedStudent: string | null
  /** A hard block the write RPC will enforce: the UI pre-disables Save and explains. */
  wouldBlock: 'self' | 'last_admin' | null
}

export async function fetchUserRoleImpact(userId: string, newRole: UserRole): Promise<UserRoleImpact> {
  const { data, error } = await supabase.rpc('fn_admin_user_role_impact', {
    p_user: userId,
    p_new_role: newRole,
  })
  if (error) throw error
  const row = (data ?? [])[0] as
    | {
        tutor_groups: string[] | null
        guardian_children: string[] | null
        linked_student: string | null
        would_block: string | null
      }
    | undefined
  return {
    tutorGroups: row?.tutor_groups ?? [],
    guardianChildren: row?.guardian_children ?? [],
    linkedStudent: row?.linked_student ?? null,
    wouldBlock: (row?.would_block as UserRoleImpact['wouldBlock']) ?? null,
  }
}

/**
 * Set a user's display name and role through the admin-only
 * `fn_admin_update_user` RPC (ADR-042) rather than a PostgREST `update`:
 * the RPC refuses to demote the last admin or to let an admin change
 * their own role, strips a downgraded tutor from every group's
 * `tutor_ids`, and writes a `user_role_changes` audit row when the role
 * actually changes.
 */
export async function updateUser(input: {
  id: string
  full_name: string
  role: UserRole
}): Promise<void> {
  const { error } = await supabase.rpc('fn_admin_update_user', {
    p_user: input.id,
    p_full_name: input.full_name,
    p_new_role: input.role,
  })
  if (error) throw error
}

/** One active guardian of a student, for the admin enrolment screens. */
export interface AdminStudentGuardian {
  user_id: string
  full_name: string
  email: string
  relation: string | null
}

export interface AdminStudent {
  id: string
  full_name: string
  date_of_birth: string
  class_id: string | null
  class: { name: string } | null
  // Every *active* guardian of this child (ADR-040). >=1, symmetric —
  // no "primary". The list line shows their names; the edit form seeds
  // its guardian editor from this.
  guardians: AdminStudentGuardian[]
  user_id: string | null
  // The linked self-login account's own name/email, joined so the
  // "link self-login" picker can show it as a selected option when
  // editing this student — it is deliberately excluded from
  // `fetchUnlinkedStudentAccounts` (that account is not *available* to
  // link, it is already linked to this row), so without this join the
  // edit form would have no way to render what is currently selected.
  user: { full_name: string; email: string } | null
}

interface RawGuardianEmbed {
  user_id: string
  relation: string | null
  unlinked_at: string | null
  guardian: { full_name: string; email: string } | null
}

export async function fetchAllStudents(): Promise<AdminStudent[]> {
  const { data, error } = await supabase
    .from('students')
    .select(
      'id, full_name, date_of_birth, class_id, user_id, ' +
        'class:classes(name), ' +
        'user:users!students_user_id_fkey(full_name, email), ' +
        'guardians:student_guardians(user_id, relation, unlinked_at, guardian:users(full_name, email))',
    )
    .order('full_name')
  if (error) throw error
  return ((data ?? []) as unknown as (Omit<AdminStudent, 'guardians'> & {
    guardians: RawGuardianEmbed[]
  })[]).map((row) => ({
    ...row,
    guardians: (row.guardians ?? [])
      .filter((g) => g.unlinked_at === null)
      .map((g) => ({
        user_id: g.user_id,
        full_name: g.guardian?.full_name ?? '',
        email: g.guardian?.email ?? '',
        relation: g.relation,
      })),
  }))
}

/** role=student users not yet linked as any student's 16+ self-login account. */
export async function fetchUnlinkedStudentAccounts(): Promise<DirectoryUser[]> {
  const [{ data: studentUsers, error: usersError }, { data: linked, error: linkedError }] = await Promise.all([
    supabase.from('users').select('id, full_name, email, role').eq('role', 'student').order('full_name'),
    supabase.from('students').select('user_id').not('user_id', 'is', null),
  ])
  if (usersError) throw usersError
  if (linkedError) throw linkedError
  const linkedIds = new Set((linked ?? []).map((s) => s.user_id))
  return (studentUsers ?? []).filter((u) => !linkedIds.has(u.id))
}

export interface SaveStudentInput {
  /** Omit / null to create; set to update. */
  id?: string | null
  full_name: string
  date_of_birth: string
  class_id: string | null
  /** 16+ self-login account, or null. */
  user_id: string | null
  /** The wanted set of guardians — at least one (ADR-040). */
  guardians: { user_id: string; relation: string | null }[]
}

/**
 * Create or update a student *and* its guardian set in one transaction,
 * through the admin-only `fn_admin_save_student` RPC (ADR-040(g)).
 *
 * One call rather than an `insert`/`update` on `students` plus separate
 * writes to `student_guardians`, because those would be separate
 * transactions: a student could momentarily exist with no guardian, and
 * the deferred `trg_student_has_guardian` constraint could not catch it
 * across two HTTP requests. The RPC diffs the guardian set — adding
 * wanted links, setting `unlinked_at` on removed ones (never deleting,
 * so the audit trail survives, D7) — so this replaces the old
 * `createStudent` and `updateStudent` both.
 */
export async function saveStudent(input: SaveStudentInput): Promise<string> {
  const { data, error } = await supabase.rpc('fn_admin_save_student', {
    p_full_name: input.full_name,
    p_dob: input.date_of_birth,
    p_guardians: input.guardians.map((g) => ({ user_id: g.user_id, relation: g.relation })),
    p_id: input.id ?? undefined,
    p_class_id: input.class_id ?? undefined,
    p_user_id: input.user_id ?? undefined,
  })
  if (error) throw error
  return data as string
}

/**
 * Permanently delete a student record. Admin-only — `students_admin_all`
 * (migration 003) is `for all`, so it covers DELETE. Every child table
 * FKs `students` with `on delete cascade` (attendance, the four progress
 * tables, year-end reports, notifications, `student_guardians`), so the
 * record and its whole history go together; `enrolment_submissions`
 * (ADR-043) is `on delete set null`, so that audit row survives with the
 * id cleared.
 *
 * The one place this is needed: cleaning up a **duplicate** created when a
 * guardian re-submits the enrolment form with a *corrected* student name
 * that no longer matches the record they already have. `fn_enrol_from_form`
 * (ADR-043) does not flag that — a guardian may legitimately have
 * same-day twins with different names, so a "same guardian + same DOB +
 * different name" rule would block real siblings — so the corrected
 * re-submission creates a second `students` row, and this is the admin's
 * path to remove it.
 */
export async function deleteStudent(id: string): Promise<void> {
  const { error } = await supabase.from('students').delete().eq('id', id)
  if (error) throw error
}
