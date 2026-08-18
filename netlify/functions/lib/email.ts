/**
 * Transactional email, via Resend.
 *
 * ── Why not Supabase's built-in email ───────────────────────────────
 * Supabase Auth's SMTP is rate-limited and documented as unsuitable for
 * production transactional volume. It was in use for one thing —
 * `inviteUserByEmail` in `invite-user.mts`, which sent GoTrue's own
 * magic-link invite as a side effect of creating the `auth.users` row —
 * until ADR-026 replaced that call with `auth.admin.createUser()`, which
 * creates the same row and sends nothing. GoTrue's mailer is unused by
 * this app now.
 *
 * ── Why email at all, when Web Push exists ──────────────────────────
 * Push is not a channel every family actually has. On iOS, Web Push
 * only works once the PWA has been added to the Home Screen (checklist
 * §5), which is an adoption step many families will never take, and the
 * project has never verified it on an iOS device at all (test-plan §6).
 * Email is additive: it reaches the people push cannot, and nothing
 * here touches the push path.
 *
 * ── Deployment prerequisites (not code bugs) ────────────────────────
 * 1. **The sending domain must be verified in the Resend dashboard.**
 *    `ppmedenhaag.nl` is verified as of ADR-031 (confirmed with a live
 *    send from the production key); until a domain is verified, Resend
 *    refuses to send from it and only allows `onboarding@resend.dev`,
 *    to the account owner's own verified address. If email fails, that
 *    prior state is worth ruling out first — it is a DNS/dashboard
 *    task, not something to debug in here.
 * 2. **Select the EU region in Resend.** Supabase is in Frankfurt and
 *    Netlify is EU-region by deliberate choice (ADR-002/ADR-004); mail
 *    carries the same personal data — a parent's address, a child's
 *    name — so the same data-residency reasoning applies. This is a
 *    dashboard setting, and it must be set before real families are
 *    invited, because it cannot be changed retroactively for mail
 *    already sent.
 * 3. `RESEND_API_KEY` must be set in Netlify. It is never read from
 *    anywhere but `process.env`, and never has a default.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/**
 * `ppmedenhaag.nl`, not the `tpa.` subdomain — PPME's Resend admin
 * verified the bare domain directly (ADR-031) rather than the
 * subdomain this address originally assumed. Deliberately the real
 * intended address rather than `resend.dev`, so that a misconfigured
 * deploy fails loudly against an unverified domain instead of quietly
 * succeeding from a sandbox sender nobody recognises.
 */
export const FROM_ADDRESS = 'TPA PPME Den Haag <tpa@ppmedenhaag.nl>'

export interface EmailRequest {
  to: string
  subject: string
  html: string
  /** Plain-text alternative. Worth sending: some clients prefer it, and it degrades better. */
  text?: string
}

export type EmailResult =
  | { status: 'sent'; id: string }
  /** Resend accepted nothing because we are over quota — free tier is 100/day, 3,000/month, 2 req/s. */
  | { status: 'rate-limited'; retryAfterSeconds: number | null }
  | { status: 'not-configured' }
  | { status: 'failed'; statusCode: number | null; message: string }

/**
 * The transport, injected so the whole path above can be tested without
 * a network and — more to the point — **without ever sending a real
 * email**. test-plan's rule is "no real student data in any test
 * environment, ever"; mail extends that to not putting anything in a
 * real inbox during development.
 */
export type Fetch = typeof fetch

/**
 * Sends one email. **Never throws** — every failure is a returned
 * value.
 *
 * That is the whole contract, and the reason for it is the call site:
 * an email is an *additional* channel alongside Web Push, so a mail
 * failure must never be able to take down the thing it accompanies. A
 * thrown error inside `invite-user` would abandon a half-finished
 * invite; a returned `failed` lets the caller log it and carry on.
 */
export async function sendEmail(request: EmailRequest, fetchImpl: Fetch = fetch): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // Fails *open* here, unlike `webhookAuth`'s shared secret which
    // fails closed. The asymmetry is deliberate: a missing webhook
    // secret would leave an endpoint unauthenticated, which is a
    // security failure; a missing mail key just means no email, which
    // is a degraded feature. Reported so a misconfigured deploy is
    // visible in the logs rather than silently mute.
    console.warn('email: RESEND_API_KEY is not set — no email sent')
    return { status: 'not-configured' }
  }

  let response: Response
  try {
    response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [request.to],
        subject: request.subject,
        html: request.html,
        ...(request.text ? { text: request.text } : {}),
      }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error'
    console.error('email: request to Resend failed', message)
    return { status: 'failed', statusCode: null, message }
  }

  if (response.status === 429) {
    // Free tier is 100/day, 3,000/month and 2 requests/second, and the
    // per-second limit is the one a class-sized loop would hit. Surfaced
    // as its own result rather than folded into `failed`, because the
    // caller's sensible response is different: a rate limit is worth
    // retrying later, a 422 from a malformed address is not.
    const retryAfter = Number(response.headers.get('retry-after'))
    console.warn('email: rate limited by Resend', response.headers.get('retry-after') ?? '')
    return {
      status: 'rate-limited',
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    }
  }

  if (!response.ok) {
    // Resend returns a JSON body with `message`; fall back to the status
    // text when it does not. The key is never echoed into a log here.
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    const message = body?.message ?? `Resend returned ${response.status}`
    console.error('email: send failed', response.status, message)
    return { status: 'failed', statusCode: response.status, message }
  }

  const body = (await response.json().catch(() => null)) as { id?: string } | null
  return { status: 'sent', id: body?.id ?? '' }
}
