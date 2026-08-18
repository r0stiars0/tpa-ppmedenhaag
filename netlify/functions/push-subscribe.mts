import { fetchFamilyRelationships } from '../../src/lib/capabilities'
import { canReceiveNotifications } from '../../src/lib/notificationRecipients'
import { authenticateCaller, jsonError, jsonOk } from './lib/callerAuth'
import { RateLimiter } from './lib/rateLimit'
import { isValidSubscription, normalizeSubscription } from './lib/webPush'

/**
 * Stores (POST) or clears (DELETE) the caller's own Web Push
 * subscription in `users.push_sub`.
 *
 * Why a Function at all, when `users_self_update` (migration 003)
 * already lets a signed-in user write their own row through PostgREST?
 * Three reasons, and no migration was needed for any of them:
 *
 *   1. **Shape validation.** `push_sub` is untyped `jsonb`. Straight
 *      through PostgREST a client could put anything in it, and the
 *      sender would then try to deliver to whatever that was.
 *      `isValidSubscription` is the only gate in front of that column.
 *   2. **Rate limiting** — checklist §6 names this endpoint
 *      specifically. See `lib/rateLimit.ts` for what that does and
 *      honestly does not cover.
 *   3. **Recipient check.** Notifications are about a child, so a
 *      subscription is only stored for an account that some child's row
 *      actually points at — their parent, or their own 16+ login
 *      (ADR-022). Collecting push endpoints for accounts we will never
 *      send to is personal data with no purpose.
 *
 *      Until ADR-022 this was a *role* check, and it 403'd a tutor whose
 *      own child attends the TPA: they could not store a subscription,
 *      so nothing about their own child could ever reach them. The
 *      question is now the relationship the account holds, asked with
 *      the same query and the same predicate the settings screen uses,
 *      so the screen offering the toggle and the Function honouring it
 *      cannot disagree.
 *
 * A user can only ever write their own row here: the id comes from the
 * validated JWT, never from the request body.
 *
 * No `config.path` export — the default route is what we want, and
 * declaring it breaks `netlify dev` (see README).
 */
const limiter = new RateLimiter({ limit: 12, windowMs: 60_000 })

export default async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return jsonError('Method not allowed', 405)
  }

  const auth = await authenticateCaller(req)
  if ('error' in auth) return auth.error
  const { caller, admin } = auth

  const { allowed, resetAt } = limiter.check(caller.id)
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
      },
    })
  }

  if (req.method === 'DELETE') {
    const { error } = await admin.from('users').update({ push_sub: null }).eq('id', caller.id)
    if (error) return jsonError(error.message, 500)
    return jsonOk({ subscribed: false })
  }

  // Asked with the service-role client, which is the only way to answer
  // it here — but the query is the caller's own id in both link columns,
  // so it is the same set of rows their own session would be shown.
  let recipient: boolean
  try {
    recipient = canReceiveNotifications(await fetchFamilyRelationships(admin, caller.id))
  } catch (err) {
    // Failing closed would silently look like "this account receives
    // nothing", which is the exact failure mode ADR-022 exists to end.
    // A 500 says a lookup broke.
    return jsonError(err instanceof Error ? err.message : 'Could not check recipients', 500)
  }
  if (!recipient) {
    return jsonError('This account is not linked to any student', 403)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  if (!isValidSubscription(body)) {
    return jsonError('Invalid push subscription', 400)
  }

  const { error } = await admin
    .from('users')
    .update({ push_sub: normalizeSubscription(body) })
    .eq('id', caller.id)
  if (error) return jsonError(error.message, 500)

  return jsonOk({ subscribed: true }, 201)
}
