import { supabase } from '../lib/supabase'

// Local-only convenience: signs into the local Supabase stack (started via
// `supabase start`) as one of the seeded fixture users, without going
// through real Google OAuth — the local stack has no OAuth provider
// configured (see README "Local Postgres"). Mints a JWT client-side using
// the Supabase CLI's well-known default local JWT secret (not a real
// secret — it's the same fixed value baked into every `supabase init`
// project) and hands it to supabase-js via `setSession`.
//
// This module is only ever imported from DevAuthSwitcher, which is only
// rendered when `import.meta.env.DEV` — Vite dead-code-eliminates that
// whole branch (and this module) out of production builds.

const LOCAL_DEV_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'

export interface FixtureUser {
  id: string
  label: string
}

// Matches supabase/dev-fixture.sql — see README "Local Postgres" for how
// to load it into a local `supabase start` stack.
export const FIXTURE_USERS: FixtureUser[] = [
  { id: 'a1000000-0000-0000-0000-000000000001', label: 'Ustadz Ahmad (Tutor — Grup A + B)' },
  // Second tutor, assigned to Grup B only — the fixture's one way to
  // check a tutor's class scoping from the browser rather than by hand
  // with a minted JWT.
  { id: 'b1000000-0000-0000-0000-000000000001', label: 'Ustadz Baru (Tutor — Grup B only)' },
  { id: 'a2000000-0000-0000-0000-000000000001', label: 'Ibu Siti (Parent — 3 children)' },
  { id: 'a2000000-0000-0000-0000-000000000002', label: 'Bapak Rudi (Parent — 2 children)' },
  { id: 'a3000000-0000-0000-0000-000000000001', label: 'Fatimah (Santri, 16+ self-login)' },
  { id: 'c1000000-0000-0000-0000-000000000001', label: 'Admin Dev (Admin)' },
  // Dual-role (TAD ADR-019) — one person, two relationships. Listed
  // last because they are the awkward cases, not the common ones. The
  // label spells out both halves because each of them now gets a scope
  // switch (ADR-025) and lands on the class shape: what is worth
  // clicking through is that the *other* half is one tap away and
  // returns exactly their own child, never their class.
  {
    id: 'd1000000-0000-0000-0000-000000000001',
    label: 'Ustadzah Aminah (Tutor Grup A + parent of Yusuf in Grup B)',
  },
  {
    id: 'd1000000-0000-0000-0000-000000000002',
    label: 'Bapak Hasan (Parent of Khadijah in Grup A + tutor of Grup B)',
  },
  // Three relationships at once. Worth clicking through whenever a query
  // grows an admin branch: for her the admin grant and the tutor
  // relationship disagree, and only one of them is the right answer for
  // a given screen.
  {
    id: 'd1000000-0000-0000-0000-000000000003',
    label: 'Ustadzah Laila (Admin + tutor of Grup A + parent of Salma in Grup B)',
  },
  // The student assistant (TAD ADR-020, ADR-023). Her `users.role` is
  // 'student' and she now lands on the *class* scope regardless, which
  // is the gap ADR-020(d) recorded and ADR-025 closed. Signing in as
  // her is how the exclusion stays honest: her own name is off the
  // roster on the five evaluative screens, and on the attendance
  // register it is shown but not submitted.
  {
    id: 'd1000000-0000-0000-0000-000000000004',
    label: 'Aisyah (Santri 16+ in Grup A + assists in Grup B)',
  },
]

function base64UrlFromBytes(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlFromJson(value: unknown): string {
  return base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer)
}

async function mintLocalDevJwt(sub: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    sub,
    role: 'authenticated',
    aud: 'authenticated',
    iss: 'supabase-demo',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
  const data = `${base64UrlFromJson(header)}.${base64UrlFromJson(payload)}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(LOCAL_DEV_JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return `${data}.${base64UrlFromBytes(signature)}`
}

export async function signInAsFixtureUser(userId: string): Promise<void> {
  const access_token = await mintLocalDevJwt(userId)
  const { error } = await supabase.auth.setSession({
    access_token,
    refresh_token: 'local-dev-fixture-refresh-token',
  })
  if (error) throw error
}
