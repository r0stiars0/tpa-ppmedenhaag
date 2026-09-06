import { authenticateCaller, jsonError, jsonOk } from './lib/callerAuth'
import { rejectRegistration } from './lib/rejectRegistration'

/**
 * Admin-only (TAD ADR-039). Deletes the pending `auth.users` row for a
 * `{ id }` via GoTrue's Admin API — the mirror of `invite-user.mts`,
 * which *creates* one. Same service-role constraint (`auth.users` is not
 * PostgREST-exposed) and the same in-code admin check, since there is no
 * RLS layer here to lean on. The "already registered" guard and the
 * cascade reasoning live in `lib/rejectRegistration.ts`.
 *
 * No `config.path` export — same as `invite-user.mts`/`health.mts`:
 * served at the default `/.netlify/functions/reject-registration`, and
 * an explicit path breaks local `netlify dev` routing.
 */
export default async (req: Request) => {
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)

  const authed = await authenticateCaller(req)
  if ('error' in authed) return authed.error
  const { caller, admin } = authed
  if (caller.role !== 'admin') {
    return jsonError('Only admins can reject registrations', 403)
  }

  let body: { id?: string }
  try {
    body = (await req.json()) as { id?: string }
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const result = await rejectRegistration(admin, body.id)
  if (!result.ok) return jsonError(result.error, result.status)
  return jsonOk({ id: result.id })
}
