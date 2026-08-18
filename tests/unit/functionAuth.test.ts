import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Who is allowed to make a Netlify Function do something.
 *
 * Every Function in this project holds the service-role key, which
 * bypasses RLS entirely — so for the duration of a request these two
 * modules *are* the access control, and the database will not catch a
 * mistake made here. They were the least covered code in the repo while
 * being the most consequential, which is the combination this file
 * exists to end.
 *
 * The two are deliberately different shapes and are tested as such:
 * `authenticateCaller` proves a *person* (a JWT, then their profile read
 * back from the database rather than taken from the token), while
 * `verifyWebhookSecret` proves a *channel* (a shared secret, for
 * requests that originate from Postgres or Netlify's scheduler and have
 * no person behind them at all).
 */
const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

const { authenticateCaller, jsonError, jsonOk } = await import(
  '../../netlify/functions/lib/callerAuth'
)
const { serviceClient, verifyWebhookSecret } = await import(
  '../../netlify/functions/lib/webhookAuth'
)

const CALLER_ID = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'header.payload.signature'

interface FakeOptions {
  user?: { id: string } | null
  userError?: unknown
  profile?: { id: string; role: string; full_name: string } | null
  profileError?: unknown
}

/**
 * Two clients get built per call — the anon one that validates the token
 * and the service-role one that reads the profile — and which key each
 * was handed is itself part of what these tests check.
 */
function fakeSupabase(options: FakeOptions = {}) {
  const built: { key: string; url: string }[] = []
  const queried: { table?: string; select?: string; eqColumn?: string; eqValue?: unknown } = {}

  createClientMock.mockImplementation((url: string, key: string) => {
    built.push({ url, key })
    return {
      auth: {
        getUser: vi.fn(async (token: string) => {
          queriedToken.value = token
          return {
            data: { user: options.user === undefined ? { id: CALLER_ID } : options.user },
            error: options.userError ?? null,
          }
        }),
      },
      from(table: string) {
        queried.table = table
        return {
          select(columns: string) {
            queried.select = columns
            return {
              eq(column: string, value: unknown) {
                queried.eqColumn = column
                queried.eqValue = value
                return {
                  maybeSingle: async () => ({
                    data:
                      options.profile === undefined
                        ? { id: CALLER_ID, role: 'admin', full_name: 'Admin Dev' }
                        : options.profile,
                    error: options.profileError ?? null,
                  }),
                }
              },
            }
          },
        }
      },
    }
  })

  const queriedToken = { value: '' }
  return { built, queried, queriedToken }
}

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://example.invalid/.netlify/functions/invite-user', {
    method: 'POST',
    headers,
  })
}

async function body(response: Response): Promise<{ error?: string }> {
  return (await response.json()) as { error?: string }
}

describe('jsonError / jsonOk', () => {
  it('are JSON with the status the caller asked for', async () => {
    const err = jsonError('Not allowed', 403)
    expect(err.status).toBe(403)
    expect(err.headers.get('content-type')).toBe('application/json')
    expect(await body(err)).toEqual({ error: 'Not allowed' })

    const ok = jsonOk({ sent: 2 })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ sent: 2 })
    expect(jsonOk({}, 202).status).toBe(202)
  })
})

describe('authenticateCaller', () => {
  beforeEach(() => {
    createClientMock.mockReset()
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon-key')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('validates the token, then reads the role from the database', async () => {
    // The property worth stating plainly: the caller's role comes from
    // `public.users`, never from the JWT. A token is something the client
    // holds and could have been minted before a demotion; the row is the
    // current truth, and the service-role client that reads it is the one
    // that will act on the answer.
    const { built, queried, queriedToken } = fakeSupabase()
    const result = await authenticateCaller(request({ authorization: `Bearer ${TOKEN}` }))

    expect('caller' in result).toBe(true)
    if (!('caller' in result)) return
    expect(result.caller).toEqual({ id: CALLER_ID, role: 'admin', full_name: 'Admin Dev' })
    expect(queriedToken.value).toBe(TOKEN)
    expect(queried.table).toBe('users')
    expect(queried.select).toBe('id, role, full_name')
    expect(queried.eqColumn).toBe('id')
    // The id filtered on is the one GoTrue returned for the token, not
    // anything the request supplied.
    expect(queried.eqValue).toBe(CALLER_ID)
    expect(built.map((c) => c.key)).toEqual(['test-anon-key', 'test-service-role-key'])
  })

  it('accepts the header case-insensitively and without the Bearer prefix', async () => {
    fakeSupabase()
    const bare = await authenticateCaller(request({ authorization: TOKEN }))
    expect('caller' in bare).toBe(true)

    const { queriedToken } = fakeSupabase()
    await authenticateCaller(request({ authorization: `bearer ${TOKEN}` }))
    expect(queriedToken.value).toBe(TOKEN)
  })

  it('refuses a request with no Authorization header, before building any client', async () => {
    const { built } = fakeSupabase()
    const result = await authenticateCaller(request())
    expect('error' in result).toBe(true)
    if (!('error' in result)) return
    expect(result.error.status).toBe(401)
    expect(await body(result.error)).toEqual({ error: 'Missing Authorization header' })
    // Nothing was constructed and nothing was asked of the database: an
    // unauthenticated request costs one string comparison.
    expect(built).toHaveLength(0)
  })

  it('refuses a token GoTrue rejects, without ever building the service-role client', async () => {
    // Step 2 must not run against a token that failed step 1 — the whole
    // point of the two-step shape. If the service-role client were built
    // first, a later edit could easily read the profile before checking.
    const { built } = fakeSupabase({ userError: { message: 'invalid JWT' }, user: null })
    const result = await authenticateCaller(request({ authorization: `Bearer ${TOKEN}` }))
    expect('error' in result).toBe(true)
    if (!('error' in result)) return
    expect(result.error.status).toBe(401)
    expect(await body(result.error)).toEqual({ error: 'Invalid or expired session' })
    expect(built.map((c) => c.key)).toEqual(['test-anon-key'])
  })

  it('refuses a valid token with no profile row behind it', async () => {
    // A real state, not a defensive one: `auth.users` gains a row the
    // moment an invitation is accepted, and `public.users` gains one when
    // an admin completes the registration. In between, the account is
    // authenticated and authorized for nothing — 403, not 401, because
    // the session is genuine.
    const { queried } = fakeSupabase({ profile: null })
    const result = await authenticateCaller(request({ authorization: `Bearer ${TOKEN}` }))
    expect('error' in result).toBe(true)
    if (!('error' in result)) return
    expect(result.error.status).toBe(403)
    expect(await body(result.error)).toEqual({ error: 'No profile for this account' })
    expect(queried.table).toBe('users')
  })

  it('surfaces a profile lookup failure as a 500 rather than as "not an admin"', async () => {
    // The failure mode to avoid is a database blip degrading into a
    // plausible-looking authorization answer, which would be silent and
    // would read as correct behaviour in the logs.
    fakeSupabase({ profileError: { message: 'connection reset' } })
    const result = await authenticateCaller(request({ authorization: `Bearer ${TOKEN}` }))
    expect('error' in result).toBe(true)
    if (!('error' in result)) return
    expect(result.error.status).toBe(500)
    expect(await body(result.error)).toEqual({ error: 'connection reset' })
  })

  it('fails closed when the environment is incomplete', async () => {
    // A Function deployed without its keys must refuse every request. It
    // holds the service-role key in production, so the alternative to a
    // hard 500 is an endpoint that behaves unpredictably at exactly the
    // moment nobody is watching it.
    const { built } = fakeSupabase()
    for (const missing of [
      'VITE_SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ] as const) {
      vi.stubEnv(missing, '')
      if (missing === 'SUPABASE_ANON_KEY') vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
      const result = await authenticateCaller(request({ authorization: `Bearer ${TOKEN}` }))
      expect('error' in result).toBe(true)
      if (!('error' in result)) return
      expect(result.error.status).toBe(500)
      expect((await body(result.error)).error).toMatch(/Server misconfigured/)
      vi.unstubAllEnvs()
      vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
      vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon-key')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
    }
    expect(built).toHaveLength(0)
  })

  it('falls back to the VITE_ anon key, which is the same public value', async () => {
    // Netlify's build environment carries `VITE_SUPABASE_ANON_KEY` for
    // the browser bundle; the Function-side name is the one deploys set
    // by hand. Accepting either is what keeps a working local `netlify
    // dev` from being a different configuration than production.
    // Unset, not empty: the fallback is `??`, so an anon key that is
    // present-but-empty is a misconfiguration rather than a reason to
    // look elsewhere. Netlify leaves an unset variable undefined, which
    // is the state this reproduces.
    vi.stubEnv('SUPABASE_ANON_KEY', undefined)
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'vite-anon-key')
    const { built } = fakeSupabase()
    const result = await authenticateCaller(request({ authorization: `Bearer ${TOKEN}` }))
    expect('caller' in result).toBe(true)
    expect(built[0].key).toBe('vite-anon-key')
  })
})

describe('verifyWebhookSecret', () => {
  const SECRET = 'a-long-shared-secret-value'

  beforeEach(() => vi.stubEnv('NOTIFY_WEBHOOK_SECRET', SECRET))
  afterEach(() => vi.unstubAllEnvs())

  function webhookRequest(secret?: string): Request {
    return new Request('https://example.invalid/.netlify/functions/notify-absence', {
      method: 'POST',
      headers: secret === undefined ? {} : { 'x-webhook-secret': secret },
    })
  }

  it('lets the matching secret through', () => {
    expect(verifyWebhookSecret(webhookRequest(SECRET))).toBeNull()
  })

  it('refuses a wrong secret of the same length', () => {
    // Same length, so the comparison reaches `timingSafeEqual` rather
    // than being decided by the length check — otherwise this test would
    // pass without the digest ever running.
    const wrong = `${'b'.repeat(SECRET.length - 1)}!`
    expect(wrong).toHaveLength(SECRET.length)
    const result = verifyWebhookSecret(webhookRequest(wrong))
    expect(result?.error.status).toBe(401)
  })

  it('refuses a wrong secret of a different length without throwing', () => {
    // `timingSafeEqual` throws on a length mismatch, which would surface
    // as a 500 and leak the expected length. The lengths are compared
    // first, and both paths end in the same opaque 401.
    for (const wrong of ['', 'short', `${SECRET}x`]) {
      const result = verifyWebhookSecret(webhookRequest(wrong))
      expect(result?.error.status).toBe(401)
    }
  })

  it('refuses a request with no secret header at all', () => {
    expect(verifyWebhookSecret(webhookRequest())?.error.status).toBe(401)
  })

  it('says the same thing however the request is wrong', async () => {
    // The body is the only channel a prober has. It must not distinguish
    // "no header" from "wrong value" from "wrong length".
    const bodies = await Promise.all(
      [webhookRequest(), webhookRequest(''), webhookRequest('wrong'), webhookRequest('x')]
        .map((req) => verifyWebhookSecret(req))
        .map((result) => body(result!.error)),
    )
    expect(bodies).toEqual(bodies.map(() => ({ error: 'Unauthorized' })))
  })

  it('fails closed when the secret is not configured at all', async () => {
    // The important one. An unset secret must refuse everything — the
    // alternative is an open endpoint that can address any family in the
    // TPA, and it would look exactly like a working deploy.
    vi.stubEnv('NOTIFY_WEBHOOK_SECRET', '')
    const result = verifyWebhookSecret(webhookRequest(SECRET))
    expect(result?.error.status).toBe(500)
    expect((await body(result!.error)).error).toMatch(/NOTIFY_WEBHOOK_SECRET is not set/)
    // …and it is not the comparison that refused it: even a request with
    // no secret at all gets the same configuration error, so a
    // misconfigured deploy is never mistaken for an attack in the logs.
    expect(verifyWebhookSecret(webhookRequest())?.error.status).toBe(500)
  })
})

describe('serviceClient', () => {
  beforeEach(() => createClientMock.mockReset())
  afterEach(() => vi.unstubAllEnvs())

  it('builds one client with the service-role key', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
    createClientMock.mockReturnValue({ marker: 'service' })

    const result = serviceClient()
    expect('client' in result).toBe(true)
    expect(createClientMock).toHaveBeenCalledTimes(1)
    expect(createClientMock.mock.calls[0][1]).toBe('test-service-role-key')
    // No session is persisted: there is no caller, so there is nothing
    // to persist and a stored session would outlive the request.
    expect(createClientMock.mock.calls[0][2]).toEqual({ auth: { persistSession: false } })
  })

  it('fails closed on a missing url or key, building nothing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const result = serviceClient()
    expect('error' in result).toBe(true)
    if (!('error' in result)) return
    expect(result.error.status).toBe(500)
    expect((await body(result.error)).error).toMatch(/Server misconfigured/)
    expect(createClientMock).not.toHaveBeenCalled()
  })
})
