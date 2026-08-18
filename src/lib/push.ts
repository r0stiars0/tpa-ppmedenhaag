import { supabase } from './supabase'
import { pushCapability } from './pushCapability'

/**
 * Browser-side Web Push plumbing: permission, subscribe/unsubscribe,
 * and storing the subscription server-side. Feature detection lives in
 * `pushCapability.ts` (importable without a Supabase client, so it can
 * be unit-tested).
 *
 * Nothing here builds notification content — payloads are constructed
 * server-side (`netlify/functions/lib/notifications.ts`) so the DPIA R6
 * content limits have exactly one implementation and one test suite.
 */
export { isIos, isStandalone, permissionState, pushCapability } from './pushCapability'
export type { PushCapability } from './pushCapability'

/**
 * VAPID public keys travel as base64url; `PushManager.subscribe` wants
 * raw bytes.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  // Built over an explicit ArrayBuffer: `applicationServerKey` wants a
  // BufferSource backed by an ArrayBuffer, and a bare `new
  // Uint8Array(length)` widens to ArrayBufferLike (which includes
  // SharedArrayBuffer) under TS 7.
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

export function vapidPublicKey(): string | null {
  return import.meta.env.VITE_VAPID_PUBLIC_KEY || null
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready
}

/** The browser's own view of whether this device is subscribed. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushCapability() !== 'ready') return null
  const registration = await readyRegistration()
  return registration.pushManager.getSubscription()
}

export type SubscriptionState =
  /** Nothing stored server-side: no notification can be delivered. */
  | 'off'
  /** Stored, and it is this device's endpoint. */
  | 'on-this-device'
  /**
   * Stored, but for a different endpoint than this browser's.
   * `users.push_sub` holds **one** subscription per user (migration 002,
   * and the TAD's Notification Spec), so a family that enables
   * notifications on a second device moves them there rather than
   * adding a device. Saying so is the honest thing to render; see TAD
   * ADR-015 for the multi-device migration path if PPME ever wants it.
   */
  | 'on-another-device'

/**
 * The state the settings screen renders.
 *
 * Deliberately keyed on what the **server** holds, not on
 * `pushManager.getSubscription()`. The browser keeps its subscription
 * object after the server has dropped it — which happens for real: a
 * push service reports an endpoint 404/410 and `notify-absence` clears
 * `users.push_sub` (seen during live verification). Reading the browser
 * alone would then show "notifications are on" to a family that can
 * never receive one again, which is the worst possible failure for this
 * feature: silent, and indistinguishable from "nothing happened today".
 */
export async function subscriptionState(): Promise<SubscriptionState> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return 'off'

  const { data, error } = await supabase
    .from('users')
    .select('push_sub')
    .eq('id', session.user.id)
    .maybeSingle()
  if (error || !data?.push_sub) return 'off'

  const stored = data.push_sub as { endpoint?: string }
  if (!stored.endpoint) return 'off'

  const mine = await currentSubscription()
  return mine && mine.endpoint === stored.endpoint ? 'on-this-device' : 'on-another-device'
}

async function callPushSubscribe(method: 'POST' | 'DELETE', body?: unknown): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch('/.netlify/functions/push-subscribe', {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? `push-subscribe failed (${res.status})`)
  }
}

export type SubscribeOutcome = 'subscribed' | 'permission-denied'

/**
 * `pushManager.subscribe()` talks to the platform's push service (FCM
 * on Chrome/Android, Apple's on iOS) and, when that service is
 * unreachable or throttling, the promise simply never settles — no
 * rejection, no error. Observed for real while verifying this feature:
 * repeated registrations from one host got quietly stalled by FCM.
 * Without a bound the settings screen sits on "please wait" forever,
 * with no way for the family to tell whether it is working.
 *
 * Raised from 30s while verifying Part 2b: a subscribe that FCM served
 * perfectly well took **32 seconds**, measured in isolation on an
 * otherwise idle machine. A 30s bound turns that into "the push service
 * is not responding" and a family who would have been subscribed is
 * told the feature is broken — a worse failure than the one the bound
 * exists to prevent, and one they have no reason to retry. The bound is
 * there to distinguish *never settles* from *slow*, and only the first
 * needs catching, so it is set well clear of how slow "slow" turns out
 * to be. A minute of a visibly pending button, on an action the family
 * just pressed, is recoverable; a false error is not.
 */
const SUBSCRIBE_TIMEOUT_MS = 60_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

export async function subscribe(): Promise<SubscribeOutcome> {
  if (pushCapability() !== 'ready') throw new Error('Push is not available in this browser')

  const key = vapidPublicKey()
  if (!key) throw new Error('VITE_VAPID_PUBLIC_KEY is not configured')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'permission-denied'

  const registration = await readyRegistration()
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await withTimeout(
      registration.pushManager.subscribe({
        // Chrome refuses a subscription without this, and a payload-less
        // ("silent") push is not something we ever send anyway.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      }),
      SUBSCRIBE_TIMEOUT_MS,
      'push-service-unreachable',
    ))

  // Store server-side *before* reporting success: a browser-side
  // subscription the server never learned about is a device that
  // believes it is subscribed and will never receive anything.
  await callPushSubscribe('POST', subscription.toJSON())
  return 'subscribed'
}

export async function unsubscribe(): Promise<void> {
  // Clear the server side first. If the browser unsubscribes but the
  // request to drop `users.push_sub` fails, the row keeps an endpoint
  // that no longer exists and every later send burns a request on a
  // 410 — whereas the reverse order leaves at worst a live browser
  // subscription that nothing sends to.
  await callPushSubscribe('DELETE')
  const subscription = await currentSubscription()
  if (subscription) await subscription.unsubscribe()
}
