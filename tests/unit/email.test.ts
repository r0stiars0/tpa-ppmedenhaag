import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FROM_ADDRESS, sendEmail } from '../../netlify/functions/lib/email'
import {
  APP_URL,
  INVITATION,
  invitationEmail,
  render,
} from '../../netlify/functions/lib/emailTemplates'

/**
 * Every test here injects a fake transport. Nothing in this file can put
 * a message in a real inbox, which is the point: test-plan's rule is "no
 * real student data in any test environment, ever", and mail extends
 * that to not sending to real people while developing.
 */
const ROLES = ['parent', 'student', 'tutor', 'admin'] as const
const LOCALES = ['id', 'nl'] as const

function fakeFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: response.status === undefined || response.status < 400,
      status: response.status ?? 200,
      headers: response.headers ?? new Headers(),
      json: response.json ?? (async () => ({ id: 'msg_test' })),
    } as unknown as Response
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('sendEmail', () => {
  beforeEach(() => vi.stubEnv('RESEND_API_KEY', 'test-key-not-a-real-credential'))
  afterEach(() => vi.unstubAllEnvs())

  it('posts to Resend with the bearer key and a JSON body', async () => {
    const { impl, calls } = fakeFetch({})
    const result = await sendEmail(
      { to: 'test@example.invalid', subject: 'S', html: '<p>H</p>', text: 'H' },
      impl,
    )

    expect(result).toEqual({ status: 'sent', id: 'msg_test' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.resend.com/emails')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer test-key-not-a-real-credential')
    expect(headers['content-type']).toBe('application/json')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: FROM_ADDRESS,
      to: ['test@example.invalid'],
      subject: 'S',
      html: '<p>H</p>',
      text: 'H',
    })
  })

  it('omits the text part when there is none, rather than sending an empty one', async () => {
    const { impl, calls } = fakeFetch({})
    await sendEmail({ to: 'a@b.invalid', subject: 'S', html: '<p>H</p>' }, impl)
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty('text')
  })

  it('reports a missing key instead of sending, and never invents one', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const { impl, calls } = fakeFetch({})
    expect(await sendEmail({ to: 'a@b.invalid', subject: 'S', html: 'H' }, impl)).toEqual({
      status: 'not-configured',
    })
    // The important half: nothing was attempted.
    expect(calls).toEqual([])
  })

  it('surfaces a 429 as its own outcome, with the retry hint', async () => {
    // The free tier is 100/day, 3,000/month and 2 requests/second. A
    // rate limit is worth retrying later; a malformed address is not,
    // so the two must not collapse into one "failed".
    const { impl } = fakeFetch({ status: 429, headers: new Headers({ 'retry-after': '7' }) })
    expect(await sendEmail({ to: 'a@b.invalid', subject: 'S', html: 'H' }, impl)).toEqual({
      status: 'rate-limited',
      retryAfterSeconds: 7,
    })
  })

  it('handles a 429 with no usable retry-after', async () => {
    const { impl } = fakeFetch({ status: 429, headers: new Headers() })
    expect(await sendEmail({ to: 'a@b.invalid', subject: 'S', html: 'H' }, impl)).toEqual({
      status: 'rate-limited',
      retryAfterSeconds: null,
    })
  })

  it('reports an API error with Resend’s own message', async () => {
    const { impl } = fakeFetch({
      status: 403,
      json: async () => ({ message: 'The ppmedenhaag.nl domain is not verified.' }),
    })
    expect(await sendEmail({ to: 'a@b.invalid', subject: 'S', html: 'H' }, impl)).toEqual({
      status: 'failed',
      statusCode: 403,
      message: 'The ppmedenhaag.nl domain is not verified.',
    })
  })

  it('never throws, so a mail failure cannot take down its caller', async () => {
    const exploding = (async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    await expect(
      sendEmail({ to: 'a@b.invalid', subject: 'S', html: 'H' }, exploding),
    ).resolves.toEqual({ status: 'failed', statusCode: null, message: 'ECONNRESET' })
  })

  it('never puts the API key in the returned result', async () => {
    const { impl } = fakeFetch({ status: 500, json: async () => ({ message: 'boom' }) })
    const result = await sendEmail({ to: 'a@b.invalid', subject: 'S', html: 'H' }, impl)
    expect(JSON.stringify(result)).not.toContain('test-key-not-a-real-credential')
  })
})

describe('invitation templates', () => {
  it('covers every role in every locale', () => {
    for (const role of ROLES) {
      for (const locale of LOCALES) {
        const t = INVITATION[role][locale]
        expect(t.subject, `${role}/${locale} subject`).toBeTruthy()
        expect(t.html, `${role}/${locale} html`).toContain('{{app_url}}')
        expect(t.text, `${role}/${locale} text`).toContain('{{app_url}}')
      }
    }
  })

  it('says something different to each role', () => {
    // The reason templates are keyed by role at all: a parent is invited
    // to follow their child, a tutor to record a class's work. If these
    // collapse to one message the key is pointless.
    const bodies = ROLES.map((r) => INVITATION[r].id.html)
    expect(new Set(bodies).size).toBe(ROLES.length)
  })

  it('keeps the Islamic greeting in both languages', () => {
    for (const role of ROLES) {
      for (const locale of LOCALES) {
        expect(INVITATION[role][locale].html).toContain("Assalamu'alaikum")
      }
    }
  })

  it('addresses a parent with the Bapak/Ibu honorific in Indonesian', () => {
    expect(INVITATION.parent.id.html).toContain('Bapak/Ibu')
  })

  it('substitutes every placeholder and leaves none behind', () => {
    const mail = invitationEmail({
      role: 'parent',
      locale: 'id',
      fullName: 'Siti Rahman',
      email: 'siti@example.invalid',
    })
    for (const part of [mail.subject, mail.html, mail.text]) {
      expect(part).not.toMatch(/\{\{\s*[a-z_]+\s*\}\}/i)
    }
    expect(mail.html).toContain('Siti Rahman')
    expect(mail.html).toContain('siti@example.invalid')
    expect(mail.html).toContain(APP_URL)
  })

  it('picks the locale from the recipient, and falls back to id rather than failing', () => {
    expect(invitationEmail({ role: 'parent', locale: 'nl', fullName: 'X', email: 'x@y.invalid' }).subject)
      .toContain('Uitnodiging')
    expect(invitationEmail({ role: 'parent', locale: 'id', fullName: 'X', email: 'x@y.invalid' }).subject)
      .toContain('Undangan')
    // A missing locale must still produce an email.
    expect(invitationEmail({ role: 'parent', locale: null, fullName: 'X', email: 'x@y.invalid' }).subject)
      .toContain('Undangan')
  })

  it('escapes HTML in a name, so a name cannot inject markup', () => {
    const mail = invitationEmail({
      role: 'parent',
      locale: 'id',
      fullName: '<img src=x onerror=alert(1)>',
      email: 'a@b.invalid',
    })
    expect(mail.html).not.toContain('<img src=x onerror=alert(1)>')
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    // The plain-text part is not HTML, so it is left readable.
    expect(mail.text).toContain('<img src=x onerror=alert(1)>')
  })

  it('leaves an unknown placeholder alone rather than blanking it', () => {
    const out = render(
      { subject: 'a {{unknown}}', html: 'b {{unknown}}', text: 'c {{unknown}}' },
      { other: 'x' },
    )
    expect(out.subject).toBe('a {{unknown}}')
  })
})
