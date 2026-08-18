import { supabase } from '../../lib/supabase'
import type { Database, Tables, TablesInsert } from '../../lib/database.types'

type UserRole = Database['public']['Enums']['user_role']

export interface PendingRegistration {
  id: string
  email: string
  created_at: string
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
  patch: Partial<Pick<AdminClass, 'name' | 'schedule' | 'tutor_ids'>>,
): Promise<AdminClass> {
  const { data, error } = await supabase.from('classes').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export interface AdminStudent {
  id: string
  full_name: string
  date_of_birth: string
  class_id: string | null
  class: { name: string } | null
  parent_id: string
  parent: { full_name: string } | null
  user_id: string | null
  // The linked self-login account's own name/email, joined so the
  // "link self-login" picker can show it as a selected option when
  // editing this student — it is deliberately excluded from
  // `fetchUnlinkedStudentAccounts` (that account is not *available* to
  // link, it is already linked to this row), so without this join the
  // edit form would have no way to render what is currently selected.
  user: { full_name: string; email: string } | null
}

export async function fetchAllStudents(): Promise<AdminStudent[]> {
  const { data, error } = await supabase
    .from('students')
    .select(
      'id, full_name, date_of_birth, class_id, parent_id, user_id, ' +
        'class:classes(name), parent:users!students_parent_id_fkey(full_name), ' +
        'user:users!students_user_id_fkey(full_name, email)',
    )
    .order('full_name')
  if (error) throw error
  return (data ?? []) as unknown as AdminStudent[]
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

export async function createStudent(row: TablesInsert<'students'>): Promise<void> {
  const { error } = await supabase.from('students').insert(row)
  if (error) throw error
}

/**
 * The only way to link a self-login account to a student *after*
 * enrollment — a santri who turns 16 (or simply creates a Google
 * account) mid-year, months after their record was created without one.
 * `createStudent` only ever sets `user_id` at the moment a student is
 * first added, which left this case with no admin path at all even
 * though `students_admin_all` (migration 003) already permits the
 * update: the gap was this function's absence, not RLS.
 */
export async function updateStudent(
  id: string,
  patch: Pick<
    TablesInsert<'students'>,
    'full_name' | 'date_of_birth' | 'class_id' | 'parent_id' | 'user_id'
  >,
): Promise<void> {
  const { error } = await supabase.from('students').update(patch).eq('id', id)
  if (error) throw error
}
