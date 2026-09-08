import { timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/lib/database.types'
import { jsonError, type ServiceClient } from './callerAuth'

/**
 * The counterpart to `callerAuth.ts`, for Functions that have **no
 * caller**.
 *
 * `authenticateCaller` validates a user's JWT and looks their role up —
 * the right shape when a signed-in person is asking for something. A
 * database webhook and a scheduled job have no signed-in person at all:
 * the request originates from Postgres or from Netlify's scheduler.
 * Reusing `callerAuth` there would mean either inventing a service
 * account to hold a JWT, or accepting an unauthenticated request. Both
 * are worse than the shape here.
 *
 * So these Functions authenticate the *channel* instead of a person,
 * with a shared secret both ends hold:
 *
 *   - Netlify holds it as `NOTIFY_WEBHOOK_SECRET`.
 *   - Postgres holds it in Supabase Vault (`notify_webhook_secret`) and
 *     sends it as `x-webhook-secret` from the trigger (migration 009).
 *
 * `enrol-from-form` (ADR-043) is a third caller of the same shape — a
 * Google Apps Script, not Postgres — so `verifyWebhookSecret` takes the
 * env-var name as a parameter. It uses its own `ENROL_FORM_SECRET`, not
 * a reuse of `NOTIFY_WEBHOOK_SECRET`: the Apps Script's key can then be
 * rotated without touching the DB-webhook channel, and a leak of one is
 * not a leak of both.
 *
 * Two properties this deliberately has:
 *
 *   1. **It fails closed.** If the secret env var is missing the
 *      Function refuses every request rather than serving them
 *      unauthenticated. A misconfigured deploy sends no notifications,
 *      which is a visible bug; the opposite is a silent open endpoint
 *      that will send a stranger's requests to real families.
 *   2. **The comparison is timing-safe.** The secret is the only thing
 *      in front of an endpoint that can address any family in the TPA.
 *
 * Authorization does not stop here. Proving the channel only earns the
 * right to *ask*; who may receive a given notification is decided
 * separately, from the database, by the Function itself — see
 * `notify-absence.mts`, where the recipient set is derived from the
 * child's active `student_guardians` links and never from anything the
 * request supplied.
 */
export type WebhookSecretEnv = 'NOTIFY_WEBHOOK_SECRET' | 'ENROL_FORM_SECRET'

export function verifyWebhookSecret(
  req: Request,
  envVar: WebhookSecretEnv = 'NOTIFY_WEBHOOK_SECRET',
): { error: Response } | null {
  const expected = process.env[envVar]
  if (!expected) {
    return { error: jsonError(`Server misconfigured: ${envVar} is not set`, 500) }
  }

  const provided = req.headers.get('x-webhook-secret') ?? ''
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on length mismatch, which would itself leak
  // the length — compare lengths separately and always run the digest.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { error: jsonError('Unauthorized', 401) }
  }

  return null
}

/**
 * A service-role client with no caller behind it. Every Function using
 * this owns its own authorization logic in code, exactly as the
 * caller-facing ones do — the service role bypasses RLS entirely.
 */
export function serviceClient(): { client: ServiceClient } | { error: Response } {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return { error: jsonError('Server misconfigured: missing Supabase environment variables', 500) }
  }
  return {
    client: createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    }),
  }
}
