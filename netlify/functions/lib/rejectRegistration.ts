import type { ServiceClient } from './callerAuth'

/**
 * Rejecting an unapproved registration (TAD ADR-039) — the core, split
 * out of `reject-registration.mts` for the same reason `reportAccess.ts`
 * and `publishFlow.ts` give for their own splits: nothing in this repo
 * unit-tests a `.mts` handler directly, so the logic that matters lives
 * here.
 *
 * The pending list is `auth.users` rows with no `public.users` row, and
 * `auth.users` is outside PostgREST/RLS entirely — so this has no policy
 * layer, and the "don't destroy a real profile" guard that ADR-038 put
 * in `registration_requests_self_insert`'s `not exists` clause has to be
 * restated here in code. `public.users.id references auth.users (id) on
 * delete cascade` (migration 002): calling `deleteUser` on an id that
 * *does* have a profile would take that profile with it, so a `409` is
 * returned and `deleteUser` is never reached. The staged
 * `registration_requests` row (migration 020) needs no explicit delete —
 * its own `on delete cascade` to `auth.users` removes it.
 */
export type RejectResult =
  | { ok: true; id: string }
  | { ok: false; status: 400 | 409 | 500; error: string }

export async function rejectRegistration(
  admin: ServiceClient,
  id: string | undefined,
): Promise<RejectResult> {
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, status: 400, error: 'id is required' }
  }

  const { data: existing, error: lookupError } = await admin
    .from('users')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (lookupError) return { ok: false, status: 500, error: lookupError.message }
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: 'This user is already registered and cannot be rejected.',
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(id)
  if (deleteError) return { ok: false, status: 400, error: deleteError.message }

  return { ok: true, id }
}
