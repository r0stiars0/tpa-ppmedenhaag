import webpush from 'web-push'
import type { Json } from '../../../src/lib/database.types'
import type { PushPayload } from './notifications'

/**
 * A stored `users.push_sub` value. Matches the browser's
 * `PushSubscription.toJSON()` shape, which is what `push-subscribe`
 * accepts and validates before it ever reaches the column.
 */
export interface StoredSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
  expirationTime?: number | null
}

export type SendResult =
  /** Delivered to the push service (which does not mean displayed). */
  | { status: 'sent' }
  /**
   * The push service says this subscription is dead (404/410). The
   * caller must clear `users.push_sub` — a subscription is invalidated
   * by the browser on permission revoke, profile reset, or reinstall,
   * and a stale one otherwise costs a failed request on every send
   * forever.
   */
  | { status: 'gone' }
  | { status: 'failed'; statusCode?: number; message: string }

/**
 * The two key lengths RFC 8291 fixes, in bytes once decoded.
 *
 * `p256dh` is an uncompressed P-256 public key — one 0x04 tag byte and
 * two 32-byte coordinates — and `auth` is a 16-byte secret. Every
 * browser that can subscribe at all produces exactly these, so checking
 * them costs nothing real and closes a hole that is otherwise permanent:
 * `web-push` validates the key *locally*, before any request, and throws
 * "The subscription p256dh value should be 65 bytes long." with **no
 * status code**. `sendPush` maps a status-less error to `failed` rather
 * than `gone` — correctly, since a network error looks the same and
 * deleting a good subscription on one is worse — so a subscription that
 * can never work is never cleared either. It burns a send attempt on
 * every notification that account is ever owed, forever.
 *
 * Checking here fixes both ends at once. `push-subscribe` refuses to
 * store one, and `buildAudiences` runs every *stored* value through this
 * same predicate, so a malformed row written before this existed stops
 * being pushed to and becomes what it always really was: a recipient
 * reached in the app rather than on their lock screen.
 */
const P256DH_BYTES = 65
const AUTH_BYTES = 16

/**
 * The decoded byte length of a base64url value, or `null` if it is not
 * base64 at all.
 *
 * The round-trip is the point. Node's decoder is lenient — it stops at
 * the first character it cannot read rather than throwing — so
 * `Buffer.from('a!!!!', 'base64url')` yields a buffer rather than an
 * error, and a plain length check on the result would pass junk. Both
 * alphabets are accepted because browsers and the odd client library
 * differ on padding and on `-_` versus `+/`, and neither difference says
 * anything about whether the key is real.
 */
function decodedByteLength(value: string): number | null {
  const normalized = value.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) return null
  const decoded = Buffer.from(normalized, 'base64url')
  if (decoded.toString('base64url') !== normalized) return null
  return decoded.length
}

export function isValidSubscription(value: unknown): value is StoredSubscription {
  if (!value || typeof value !== 'object') return false
  const sub = value as Record<string, unknown>
  if (typeof sub.endpoint !== 'string') return false

  // Push services are all HTTPS; anything else is either junk or an
  // attempt to point the sender somewhere it shouldn't go.
  let url: URL
  try {
    url = new URL(sub.endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  // Endpoints are short; a multi-kilobyte one is not a real subscription.
  if (sub.endpoint.length > 1024) return false

  const keys = sub.keys as Record<string, unknown> | undefined
  if (!keys || typeof keys !== 'object') return false
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return false
  // Exact lengths rather than "non-empty and not absurd": see the note on
  // P256DH_BYTES. A key of the wrong length is not a subscription that
  // might work on a better day, it is one `web-push` refuses to send to
  // before it opens a socket.
  if (decodedByteLength(keys.p256dh) !== P256DH_BYTES) return false
  if (decodedByteLength(keys.auth) !== AUTH_BYTES) return false

  return true
}

/**
 * Normalizes to exactly the three fields we store — a client cannot get
 * extra keys persisted into the jsonb column by sending them. Typed as
 * `Json` because that is what the `push_sub` column accepts.
 */
export function normalizeSubscription(sub: StoredSubscription): Json {
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  }
}

export function vapidConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

let configured = false

function configure(): void {
  if (configured) return
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) throw new Error('VAPID keys are not configured')
  // The `mailto:` subject is what a push service contacts if our sends
  // start misbehaving; it is part of the VAPID spec, not optional.
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:info@ppmedenhaag.nl',
    publicKey,
    privateKey,
  )
  configured = true
}

export async function sendPush(
  subscription: StoredSubscription,
  payload: PushPayload,
): Promise<SendResult> {
  configure()
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 60 * 60 * 12, // half a day: a "not present today" notice is worthless tomorrow
      urgency: 'normal',
    })
    return { status: 'sent' }
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode
    if (statusCode === 404 || statusCode === 410) return { status: 'gone' }
    return {
      status: 'failed',
      statusCode,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
