import { createClient } from '@supabase/supabase-js'
import { sendEmail } from './lib/email'
import { invitationEmail } from './lib/emailTemplates'

const VALID_ROLES = ['admin', 'tutor', 'parent', 'student'] as const
type UserRole = (typeof VALID_ROLES)[number]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Admin-only. Invites a new user by email (creates their auth.users row
 * via GoTrue, confirmed, and sends no email of its own — see ADR-026)
 * and immediately creates their public.users profile with the given
 * name/role — collapsing the previous two-step flow ("they sign in once
 * unprompted, then an admin notices and registers them" via
 * RegistrationsPage) into one admin action. Uses the service-role key,
 * which bypasses RLS entirely — the caller's admin-ness is therefore
 * verified here, in code, rather than relied on from the client.
 *
 * No `config.path` export here — see health.mts's comment: it's already
 * served at the default `/.netlify/functions/invite-user`, and declaring
 * that path explicitly breaks local `netlify dev` routing.
 *
 * Resilient to partial failure: if the invite succeeds but the profile
 * insert fails, the auth.users row is left exactly in the state a
 * direct (non-invited) Google sign-in would leave it — still visible
 * via fn_pending_registrations() for an admin to finish from
 * RegistrationsPage, not a stuck or duplicate account.
 */
export default async (req: Request) => {
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonError('Server misconfigured: missing Supabase environment variables', 500)
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return jsonError('Missing Authorization header', 401)

  // Validates the caller's JWT against GoTrue and identifies them — does
  // not by itself confirm they're an admin, that's the lookup below.
  const callerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(token)
  if (callerError || !callerData.user) return jsonError('Invalid or expired session', 401)

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: callerProfile, error: profileError } = await adminClient
    .from('users')
    .select('role')
    .eq('id', callerData.user.id)
    .maybeSingle()
  if (profileError) return jsonError(profileError.message, 500)
  if (!callerProfile || callerProfile.role !== 'admin') {
    return jsonError('Only admins can invite users', 403)
  }

  let body: { email?: string; full_name?: string; role?: string }
  try {
    body = (await req.json()) as { email?: string; full_name?: string; role?: string }
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const email = body.email?.trim().toLowerCase() ?? ''
  const fullName = body.full_name?.trim() ?? ''
  const role = body.role

  if (!EMAIL_RE.test(email)) return jsonError('Invalid email address', 400)
  if (!fullName) return jsonError('full_name is required', 400)
  if (!role || !VALID_ROLES.includes(role as UserRole)) {
    return jsonError(`role must be one of: ${VALID_ROLES.join(', ')}`, 400)
  }

  // Creates the auth.users row without GoTrue's own invite email (ADR-018(b)
  // resolved this deliberately — see ADR-026). `email_confirm: true` is set
  // because this address was just typed by an admin, not claimed by the
  // person signing up; the subsequent Google OAuth sign-in links to this row
  // by matching `email`, exactly as it did when the row came from
  // `inviteUserByEmail`.
  const { data: invited, error: inviteError } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (inviteError || !invited.user) {
    // Unlike inviteUserByEmail (idempotent — it returned the existing
    // user), createUser errors outright on an already-registered email,
    // with this code. Caught here rather than left to surface as a
    // generic 400, so the response is unchanged from before this change.
    if (inviteError?.code === 'email_exists') {
      return jsonError('This email is already registered.', 409)
    }
    return jsonError(inviteError?.message ?? 'Failed to create user', 400)
  }

  const { error: insertError } = await adminClient.from('users').insert({
    id: invited.user.id,
    email,
    full_name: fullName,
    role: role as UserRole,
    locale: 'id',
  })
  if (insertError) {
    // A unique violation here is a partial failure, not a duplicate
    // invite — createUser above already rejects an already-registered
    // email, so a fresh auth.users row landing on a taken email/id can
    // only mean a race with another request.
    return jsonError(
      `User created, but creating the profile failed (${insertError.message}). ` +
        'They will appear under pending registrations to finish manually.',
      500,
    )
  }

  // ── The branded invitation email (ADR-018) ────────────────────────
  // Deliberately *after* the profile insert and deliberately unable to
  // affect it. The account exists at this point; an email is a courtesy
  // on top, exactly as a push notification is, and the same rule
  // applies — a mail provider having a bad minute must not turn a
  // successful invite into a failed one. `sendEmail` never throws, and
  // its result is reported rather than acted on.
  //
  // One call site, four roles: the template is chosen by `role`, so a
  // tutor is invited to record a class's work and a parent to follow
  // their child, without four separate integrations.
  //
  // `locale` is the freshly-created row's default (`id`) — this is the
  // one email in the system sent before its recipient has ever had a
  // chance to choose a language. Every later email will read
  // `users.locale`, which is why `invitationEmail` takes it rather than
  // assuming.
  const invitation = invitationEmail({
    role: role as UserRole,
    locale: 'id',
    fullName,
    email,
  })
  const emailResult = await sendEmail({
    to: email,
    subject: invitation.subject,
    html: invitation.html,
    text: invitation.text,
  })
  if (emailResult.status !== 'sent') {
    console.warn(`invite-user: invitation email not sent (${emailResult.status}) for ${role}`)
  }

  return new Response(
    JSON.stringify({
      id: invited.user.id,
      email,
      // Surfaced so an admin screen can eventually say "invited, but the
      // welcome email did not go out" instead of implying both worked.
      invitation_email: emailResult.status,
    }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  )
}
