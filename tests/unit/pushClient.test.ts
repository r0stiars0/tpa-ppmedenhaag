import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The browser half of Web Push: what the settings screen is told, and
 * the two orderings that keep "notifications are on" from being a lie.
 *
 * `pushCapability.test.ts` covers feature detection and `push.test.ts`
 * covers the subscription validation a Function does on the way in.
 * Between them sat this module — the flow the family actually drives —
 * with no coverage at all, because it imports the Supabase singleton and
 * touches four browser APIs. Both are stubbed here.
 *
 * Everything below is about one failure: a device that believes it is
 * subscribed and will never receive anything. It is silent, and from the
 * family's side it is indistinguishable from a quiet week.
 */
const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    auth: { getSession: vi.fn() },
    from: vi.fn(),
  },
}))

vi.mock('../../src/lib/supabase', () => ({ supabase: supabaseMock }))

const { currentSubscription, subscribe, subscriptionState, unsubscribe, vapidPublicKey } =
  await import('../../src/lib/push')

const USER_ID = '11111111-1111-4111-8111-111111111111'
const THIS_DEVICE = 'https://fcm.googleapis.com/fcm/send/this-device'
const OTHER_DEVICE = 'https://fcm.googleapis.com/fcm/send/other-device'
const VAPID = 'BFakeVapidPublicKeyForTestingOnly_'

interface Browser {
  /** What `pushManager.getSubscription()` resolves to. */
  existing?: { endpoint: string } | null
  /** What a fresh `pushManager.subscribe()` resolves to; `never` hangs. */
  subscribeTo?: { endpoint: string } | 'never'
  permission?: NotificationPermission
  ready?: boolean
}

function stubBrowser(browser: Browser = {}) {
  const unsubscribed: string[] = []
  const subscribeCalls: Record<string, unknown>[] = []

  const subscription = (endpoint: string) => ({
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }),
    unsubscribe: async () => {
      unsubscribed.push(endpoint)
      return true
    },
  })

  const registration = {
    pushManager: {
      getSubscription: async () =>
        browser.existing === undefined || browser.existing === null
          ? null
          : subscription(browser.existing.endpoint),
      subscribe: (options: Record<string, unknown>) => {
        subscribeCalls.push(options)
        if (browser.subscribeTo === 'never') return new Promise(() => {})
        return Promise.resolve(subscription(browser.subscribeTo?.endpoint ?? THIS_DEVICE))
      },
    },
  }

  // The key is omitted rather than set to undefined: `pushCapability()`
  // asks `'serviceWorker' in navigator`, which a present-but-undefined
  // property satisfies.
  const fakeNavigator: Record<string, unknown> = {
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) Chrome/120.0.0.0 Mobile Safari/537.36',
    maxTouchPoints: 0,
  }
  if (browser.ready !== false) fakeNavigator.serviceWorker = { ready: Promise.resolve(registration) }
  vi.stubGlobal('navigator', fakeNavigator)
  vi.stubGlobal('window', {
    PushManager: class {},
    Notification: { permission: browser.permission ?? 'granted' },
    matchMedia: () => ({ matches: false }),
  })
  vi.stubGlobal('Notification', {
    permission: browser.permission ?? 'granted',
    requestPermission: async () => browser.permission ?? 'granted',
  })

  return { unsubscribed, subscribeCalls }
}

/** `users.push_sub` as the settings screen reads it back. */
function stubStoredSubscription(pushSub: unknown, error: unknown = null) {
  supabaseMock.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: pushSub === undefined ? null : { push_sub: pushSub }, error }),
      }),
    }),
  })
}

function stubSession(session: { access_token: string } | null) {
  supabaseMock.auth.getSession.mockResolvedValue({
    data: { session: session === null ? null : { ...session, user: { id: USER_ID } } },
  })
}

function stubFetch(response: { ok?: boolean; status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return {
        ok: response.ok ?? true,
        status: response.status ?? 200,
        json: async () => response.body ?? {},
      } as unknown as Response
    }),
  )
  return calls
}

beforeEach(() => {
  supabaseMock.auth.getSession.mockReset()
  supabaseMock.from.mockReset()
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', VAPID)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('vapidPublicKey', () => {
  it('is null rather than an empty string when unconfigured', () => {
    // `subscribe()` branches on it, and `''` would pass a truthiness
    // check in a future caller before failing deep inside the browser.
    expect(vapidPublicKey()).toBe(VAPID)
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '')
    expect(vapidPublicKey()).toBeNull()
  })
})

describe('subscriptionState — what the settings screen renders', () => {
  it('is off when nobody is signed in', async () => {
    stubBrowser()
    stubSession(null)
    await expect(subscriptionState()).resolves.toBe('off')
  })

  it('is off when the server holds nothing, whatever the browser thinks', async () => {
    // The case this function exists for. The browser keeps its
    // subscription object after a sender has cleared `users.push_sub` on
    // a 410 — reading the browser alone would show "on" to a family who
    // can never receive another notification.
    stubBrowser({ existing: { endpoint: THIS_DEVICE } })
    stubSession({ access_token: 'token' })
    stubStoredSubscription(null)
    await expect(subscriptionState()).resolves.toBe('off')
  })

  it('is off when the stored value has no endpoint', async () => {
    stubBrowser({ existing: { endpoint: THIS_DEVICE } })
    stubSession({ access_token: 'token' })
    stubStoredSubscription({ keys: { p256dh: 'x', auth: 'y' } })
    await expect(subscriptionState()).resolves.toBe('off')
  })

  it('is off when the row cannot be read at all', async () => {
    // A failed read must not render as "on": the honest answer when we
    // do not know is the one that offers the family the button.
    stubBrowser({ existing: { endpoint: THIS_DEVICE } })
    stubSession({ access_token: 'token' })
    stubStoredSubscription(null, { message: 'permission denied' })
    await expect(subscriptionState()).resolves.toBe('off')
  })

  it('is on-this-device when the stored endpoint is this browser’s', async () => {
    stubBrowser({ existing: { endpoint: THIS_DEVICE } })
    stubSession({ access_token: 'token' })
    stubStoredSubscription({ endpoint: THIS_DEVICE })
    await expect(subscriptionState()).resolves.toBe('on-this-device')
  })

  it('is on-another-device when the stored endpoint belongs to another', async () => {
    // `users.push_sub` holds one subscription per person, so enabling
    // notifications on a second phone moves them rather than adding a
    // device. Saying so is the honest thing to render.
    stubBrowser({ existing: { endpoint: THIS_DEVICE } })
    stubSession({ access_token: 'token' })
    stubStoredSubscription({ endpoint: OTHER_DEVICE })
    await expect(subscriptionState()).resolves.toBe('on-another-device')
  })

  it('is on-another-device when this browser has no subscription of its own', async () => {
    stubBrowser({ existing: null })
    stubSession({ access_token: 'token' })
    stubStoredSubscription({ endpoint: OTHER_DEVICE })
    await expect(subscriptionState()).resolves.toBe('on-another-device')
  })
})

describe('currentSubscription', () => {
  it('is null on a browser that cannot do push, without touching the API', async () => {
    stubBrowser({ ready: false })
    await expect(currentSubscription()).resolves.toBeNull()
  })
})

describe('subscribe', () => {
  it('stores server-side before reporting success', async () => {
    // The ordering the comment in `push.ts` calls out, asserted: a
    // browser-side subscription the server never learned about is a
    // device that believes it is subscribed and will never receive
    // anything.
    stubBrowser({ existing: null })
    stubSession({ access_token: 'token' })
    const calls = stubFetch({})

    await expect(subscribe()).resolves.toBe('subscribed')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/.netlify/functions/push-subscribe')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      endpoint: THIS_DEVICE,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    })
    // The caller's own JWT: `push-subscribe` decides from the database
    // whether this account may be stored at all (ADR-022), and it needs
    // to know who is asking.
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer token')
  })

  it('does not report success when the server refuses to store it', async () => {
    // A tutor with no child of their own is 403'd here by design. The
    // screen must show the failure rather than a toggle that is on.
    stubBrowser({ existing: null })
    stubSession({ access_token: 'token' })
    stubFetch({ ok: false, status: 403, body: { error: 'Not a notification recipient' } })
    await expect(subscribe()).rejects.toThrow('Not a notification recipient')
  })

  it('falls back to the status when the error body is unreadable', async () => {
    stubBrowser({ existing: null })
    stubSession({ access_token: 'token' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json')
        },
      })),
    )
    await expect(subscribe()).rejects.toThrow('push-subscribe failed (502)')
  })

  it('reuses an existing browser subscription rather than minting a second', async () => {
    // Re-subscribing produces a different endpoint on some browsers,
    // which would strand the stored one.
    stubBrowser({ existing: { endpoint: OTHER_DEVICE } })
    stubSession({ access_token: 'token' })
    const calls = stubFetch({})
    const { subscribeCalls } = stubBrowser({ existing: { endpoint: OTHER_DEVICE } })

    await expect(subscribe()).resolves.toBe('subscribed')
    expect(subscribeCalls).toHaveLength(0)
    expect(JSON.parse(calls[0].init.body as string).endpoint).toBe(OTHER_DEVICE)
  })

  it('subscribes with userVisibleOnly and the VAPID key as bytes', async () => {
    // Chrome refuses a subscription without `userVisibleOnly`, and the
    // key travels as base64url while `applicationServerKey` wants raw
    // bytes — a mismatch here fails inside the browser with no useful
    // message.
    const { subscribeCalls } = stubBrowser({ existing: null })
    stubSession({ access_token: 'token' })
    stubFetch({})

    await subscribe()
    expect(subscribeCalls[0].userVisibleOnly).toBe(true)
    expect(subscribeCalls[0].applicationServerKey).toBeInstanceOf(Uint8Array)
    expect((subscribeCalls[0].applicationServerKey as Uint8Array).byteLength).toBeGreaterThan(0)
  })

  it('reports a declined permission rather than throwing', async () => {
    // Declining is a choice, not an error, and the screen says something
    // different for it.
    stubBrowser({ existing: null, permission: 'denied' })
    const calls = stubFetch({})
    await expect(subscribe()).resolves.toBe('permission-denied')
    // …and nothing is stored for a family who said no.
    expect(calls).toHaveLength(0)
  })

  it('refuses before prompting when push is unavailable or unconfigured', async () => {
    stubBrowser({ ready: false })
    await expect(subscribe()).rejects.toThrow('Push is not available in this browser')

    stubBrowser({ existing: null })
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '')
    await expect(subscribe()).rejects.toThrow('VITE_VAPID_PUBLIC_KEY is not configured')
  })

  it('refuses when there is no session to attribute the subscription to', async () => {
    stubBrowser({ existing: null })
    stubSession(null)
    stubFetch({})
    await expect(subscribe()).rejects.toThrow('Not signed in')
  })

  it('gives up on a push service that never answers, after a minute', async () => {
    // Observed for real: FCM quietly stalls repeated registrations from
    // one host and the promise never settles — no rejection, no error.
    // Without the bound the settings screen sits on "please wait"
    // forever. The bound is 60s rather than 30 because a subscribe that
    // FCM served perfectly well took 32 seconds while verifying part 2b,
    // and a false error is worse than a slow button.
    vi.useFakeTimers()
    stubBrowser({ existing: null, subscribeTo: 'never' })
    stubSession({ access_token: 'token' })
    stubFetch({})

    const pending = subscribe()
    const assertion = expect(pending).rejects.toThrow('push-service-unreachable')
    await vi.advanceTimersByTimeAsync(59_000)
    await vi.advanceTimersByTimeAsync(2_000)
    await assertion
  })
})

describe('unsubscribe', () => {
  it('clears the server side first, then the browser’s', async () => {
    // The reverse order leaves `users.push_sub` holding an endpoint that
    // no longer exists, and every later send burns a request on a 410.
    // This order leaves at worst a live browser subscription that
    // nothing sends to.
    const { unsubscribed } = stubBrowser({ existing: { endpoint: THIS_DEVICE } })
    stubSession({ access_token: 'token' })
    const calls = stubFetch({})

    await unsubscribe()
    expect(calls[0].init.method).toBe('DELETE')
    expect(unsubscribed).toEqual([THIS_DEVICE])
  })

  it('leaves the browser alone when the server call fails', async () => {
    const { unsubscribed } = stubBrowser({ existing: { endpoint: THIS_DEVICE } })
    stubSession({ access_token: 'token' })
    stubFetch({ ok: false, status: 500, body: { error: 'nope' } })

    await expect(unsubscribe()).rejects.toThrow('nope')
    expect(unsubscribed).toEqual([])
  })

  it('is a no-op on the browser side when this device holds nothing', async () => {
    const { unsubscribed } = stubBrowser({ existing: null })
    stubSession({ access_token: 'token' })
    stubFetch({})
    await expect(unsubscribe()).resolves.toBeUndefined()
    expect(unsubscribed).toEqual([])
  })
})
