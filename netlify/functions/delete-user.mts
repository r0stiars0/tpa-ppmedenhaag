import { authenticateCaller, jsonError, jsonOk } from './lib/callerAuth'
import { deleteRegisteredUser } from './lib/deleteUser'

/**
 * Admin-only (TAD ADR-043). Permanently deletes a **registered**
 * `parent` or `student` account for a `{ id }` via GoTrue's Admin API —
 * for cleaning up a bogus account a malicious enrolment-form submission
 * created. Unlike `reject-registration.mts` (pending, no-profile rows
 * only), this deletes an account that *has* a `public.users` profile;
 * the guards (own account, deletable role, no guardian links) are in
 * `lib/deleteUser.ts`.
 *
 * No `config.path` export — same as `invite-user.mts` / `health.mts`:
 * served at the default `/.netlify/functions/delete-user`, and an
 * explicit path breaks local `netlify dev` routing.
 */
export default async (req: Request) => {
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)

  const authed = await authenticateCaller(req)
  if ('error' in authed) return authed.error
  const { caller, admin } = authed
  if (caller.role !== 'admin') {
    return jsonError('Only admins can delete users', 403)
  }

  let body: { id?: string }
  try {
    body = (await req.json()) as { id?: string }
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const result = await deleteRegisteredUser(admin, caller.id, body.id)
  if (!result.ok) return jsonError(result.error, result.status)
  return jsonOk({ id: result.id })
}
