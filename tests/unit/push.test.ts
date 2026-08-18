import { describe, expect, it } from 'vitest'
import { RateLimiter } from '../../netlify/functions/lib/rateLimit'
import { isValidSubscription, normalizeSubscription } from '../../netlify/functions/lib/webPush'

const VALID = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=', auth: 'tBHItJI5svbpez7KI4CCXg==' },
}

describe('push subscription validation', () => {
  it('accepts a real browser subscription', () => {
    expect(isValidSubscription(VALID)).toBe(true)
  })

  it('rejects anything that is not a subscription', () => {
    for (const junk of [null, undefined, 'string', 42, [], {}]) {
      expect(isValidSubscription(junk), String(junk)).toBe(false)
    }
  })

  it('rejects a missing or malformed key pair', () => {
    expect(isValidSubscription({ endpoint: VALID.endpoint })).toBe(false)
    expect(isValidSubscription({ endpoint: VALID.endpoint, keys: {} })).toBe(false)
    expect(isValidSubscription({ endpoint: VALID.endpoint, keys: { p256dh: 'x' } })).toBe(false)
    expect(isValidSubscription({ endpoint: VALID.endpoint, keys: { p256dh: '', auth: 'y' } })).toBe(false)
  })

  it('rejects a non-HTTPS endpoint', () => {
    // `push_sub` is untyped jsonb and the sender will POST to whatever
    // is in it — this check is the only thing standing between a
    // client-supplied string and an outbound request.
    expect(isValidSubscription({ ...VALID, endpoint: 'http://evil.example/push' })).toBe(false)
    expect(isValidSubscription({ ...VALID, endpoint: 'file:///etc/passwd' })).toBe(false)
    expect(isValidSubscription({ ...VALID, endpoint: 'not a url' })).toBe(false)
  })

  it('rejects a key pair that is the wrong length to be a key pair', () => {
    // The case this check exists for. Both of these are well-formed
    // base64 and neither is a P-256 key, so `web-push` refuses them
    // locally — before any request, with no status code — which
    // `sendPush` can only record as `failed`, never as `gone`. Stored,
    // they would cost that account a doomed send on every notification
    // they are ever owed. `scripts/verify-push.mjs` §8 used exactly this
    // shape until it was found doing it.
    expect(isValidSubscription({ ...VALID, keys: { p256dh: 'a', auth: 'b' } })).toBe(false)
    expect(isValidSubscription({ ...VALID, keys: { ...VALID.keys, auth: 'dBHItJI5svbpez7KI4CC' } })).toBe(false)
    expect(isValidSubscription({ ...VALID, keys: { ...VALID.keys, p256dh: VALID.keys.auth } })).toBe(false)
  })

  it('accepts either base64 alphabet, padded or not', () => {
    // A browser hands back base64url; some client libraries re-encode
    // with `+/` and padding on the way through. Neither says anything
    // about whether the key is real, so neither is rejected.
    const standard = VALID.keys.p256dh.replace(/-/g, '+').replace(/_/g, '/')
    expect(isValidSubscription({ ...VALID, keys: { ...VALID.keys, p256dh: standard } })).toBe(true)
    expect(
      isValidSubscription({ ...VALID, keys: { ...VALID.keys, auth: VALID.keys.auth.replace(/=+$/, '') } }),
    ).toBe(true)
  })

  it('rejects base64 that is not really base64', () => {
    // Node's decoder stops at the first unreadable character rather
    // than throwing, so a length check on what it returns would pass
    // junk that happens to start with enough valid characters.
    expect(isValidSubscription({ ...VALID, keys: { ...VALID.keys, auth: 'tBHItJI5svbpez7KI4CC!!' } })).toBe(false)
    expect(isValidSubscription({ ...VALID, keys: { ...VALID.keys, auth: 'tBHItJI5 svbpez7KI4CCXg' } })).toBe(false)
  })

  it('rejects absurdly long values', () => {
    expect(isValidSubscription({ ...VALID, endpoint: `https://x.example/${'a'.repeat(1100)}` })).toBe(false)
    expect(isValidSubscription({ ...VALID, keys: { ...VALID.keys, auth: 'a'.repeat(300) } })).toBe(false)
  })

  it('stores only the three fields we use', () => {
    const stored = normalizeSubscription({
      ...VALID,
      // A client can send whatever it likes; none of it should land in
      // the column.
      ...({ tracking: 'x', expirationTime: 12345 } as object),
    } as Parameters<typeof normalizeSubscription>[0])

    expect(stored).toEqual({
      endpoint: VALID.endpoint,
      keys: { p256dh: VALID.keys.p256dh, auth: VALID.keys.auth },
    })
  })
})

describe('rate limiting (checklist §6)', () => {
  it('allows up to the limit, then refuses', () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 })
    const t0 = 1_000_000

    expect(limiter.check('user-1', t0).allowed).toBe(true)
    expect(limiter.check('user-1', t0 + 1).allowed).toBe(true)
    expect(limiter.check('user-1', t0 + 2).allowed).toBe(true)

    const blocked = limiter.check('user-1', t0 + 3)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it('counts each key separately', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 })
    const t0 = 1_000_000

    expect(limiter.check('user-1', t0).allowed).toBe(true)
    expect(limiter.check('user-1', t0).allowed).toBe(false)
    // One noisy account must not lock out everyone else.
    expect(limiter.check('user-2', t0).allowed).toBe(true)
  })

  it('opens a fresh window once the old one expires', () => {
    const limiter = new RateLimiter({ limit: 2, windowMs: 60_000 })
    const t0 = 1_000_000

    limiter.check('user-1', t0)
    limiter.check('user-1', t0)
    expect(limiter.check('user-1', t0 + 59_999).allowed).toBe(false)
    expect(limiter.check('user-1', t0 + 60_000).allowed).toBe(true)
  })

  it('reports when the window resets', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 30_000 })
    const t0 = 1_000_000
    expect(limiter.check('user-1', t0).resetAt).toBe(t0 + 30_000)
    expect(limiter.check('user-1', t0 + 10).resetAt).toBe(t0 + 30_000)
  })
})
