import type { ServiceClient, UserRole } from './callerAuth'

/**
 * Deleting a **registered** account (TAD ADR-043) — the counterpart to
 * `rejectRegistration`, which only ever touches a *pending* `auth.users`
 * row (no `public.users` profile) and refuses one that has a profile.
 * This one is for the opposite case: a profiled account that should not
 * exist — overwhelmingly a bogus `parent` a malicious form submission
 * created, occasionally a junk 16+ `student` self-login.
 *
 * Split out of `delete-user.mts` for the repo reason: nothing unit-tests
 * a `.mts` handler, so the guards live here.
 *
 * Guards, in order:
 *   - an id is required, and it is never the caller's own account;
 *   - the id must have a `public.users` profile (a pending sign-in with
 *     none is rejected from Registrations instead — ADR-039);
 *   - the role must be `parent` or `student` — the only two the
 *     enrolment form can create. A `tutor`/`admin` account is staff and
 *     is offboarded by a role change (ADR-042), not deleted here, so
 *     deleting classes/reports out from under one is never possible;
 *   - `student_guardians.user_id` is `ON DELETE RESTRICT` (ADR-040 keeps
 *     removed links for audit), so a guardian link — active or
 *     historical — blocks the delete. Surfaced as a `409` with a clear
 *     next step rather than a raw FK error from GoTrue.
 *
 * The delete itself is `auth.admin.deleteUser`; `public.users.id
 * references auth.users (id) on delete cascade` (migration 002) takes the
 * profile, and `notifications` (`on delete cascade`) its centre rows.
 * `enrolment_submissions.parent_user_id` is `on delete set null`, so the
 * enrolment audit row survives with the id cleared. The whole thing is
 * one transaction inside GoTrue — a blocked cascade rolls the auth row
 * back too, so there is no half-deleted state.
 */
export type DeleteUserResult =
  | { ok: true; id: string }
  | { ok: false; status: 400 | 403 | 409 | 500; error: string }

const DELETABLE_ROLES: readonly UserRole[] = ['parent', 'student']

export async function deleteRegisteredUser(
  admin: ServiceClient,
  callerId: string,
  id: string | undefined,
): Promise<DeleteUserResult> {
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, status: 400, error: 'id is required' }
  }
  if (id === callerId) {
    return { ok: false, status: 403, error: 'You cannot delete your own account.' }
  }

  const { data: profile, error: lookupError } = await admin
    .from('users')
    .select('role')
    .eq('id', id)
    .maybeSingle()
  if (lookupError) return { ok: false, status: 500, error: lookupError.message }
  if (!profile) {
    return {
      ok: false,
      status: 409,
      error: 'No registered account with this id — a pending sign-in is rejected from Registrations.',
    }
  }
  if (!DELETABLE_ROLES.includes(profile.role)) {
    return {
      ok: false,
      status: 403,
      error: `A ${profile.role} account is managed from the user directory, not deleted here.`,
    }
  }

  const { count, error: linkError } = await admin
    .from('student_guardians')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', id)
  if (linkError) return { ok: false, status: 500, error: linkError.message }
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      status: 409,
      error:
        'This account still guards student records. Delete those students (Kelola → Santri), or unlink the account from them, first.',
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(id)
  if (deleteError) return { ok: false, status: 400, error: deleteError.message }

  return { ok: true, id }
}
