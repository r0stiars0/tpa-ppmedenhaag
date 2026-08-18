import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/lib/database.types'

export type UserRole = Database['public']['Enums']['user_role']
export type ServiceClient = SupabaseClient<Database>

export interface Caller {
  id: string
  role: UserRole
  full_name: string
}

export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * The shape every service-role Function in this project uses, extracted
 * from `invite-user.mts` when the year-end report Functions became the
 * second, third and fourth to need it:
 *
 *   1. validate the caller's JWT with a plain anon-key client (that call
 *      goes to GoTrue and proves who they are — nothing more), then
 *   2. look their role up independently with the service-role client.
 *
 * The client is never trusted to self-report its role, and step 2 never
 * runs against a token that failed step 1. The service-role client
 * bypasses RLS entirely, so every Function that holds one owns its own
 * authorization check in code — the checks in the three report Functions
 * deliberately restate the `year_end_reports` RLS rules rather than
 * inheriting them.
 */
export async function authenticateCaller(
  req: Request,
): Promise<{ caller: Caller; admin: ServiceClient } | { error: Response }> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return { error: jsonError('Server misconfigured: missing Supabase environment variables', 500) }
  }

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return { error: jsonError('Missing Authorization header', 401) }

  const callerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(token)
  if (callerError || !callerData.user) return { error: jsonError('Invalid or expired session', 401) }

  const admin: ServiceClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  const { data: profile, error: profileError } = await admin
    .from('users')
    .select('id, role, full_name')
    .eq('id', callerData.user.id)
    .maybeSingle()
  if (profileError) return { error: jsonError(profileError.message, 500) }
  if (!profile) return { error: jsonError('No profile for this account', 403) }

  return { caller: { id: profile.id, role: profile.role, full_name: profile.full_name }, admin }
}
