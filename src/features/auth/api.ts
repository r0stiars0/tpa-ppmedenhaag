import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

/**
 * A signed-in-but-unregistered user's staged registration request
 * (`public.registration_requests`, ADR-038). `full_name` is `NOT NULL`
 * in the schema; `description` is optional.
 */
export interface MyRegistrationRequest {
  full_name: string
  description: string | null
}

/** The user's own row, or `null` if they have not submitted one yet. */
export async function fetchMyRegistrationRequest(
  userId: string,
): Promise<MyRegistrationRequest | null> {
  const { data, error } = await supabase
    .from('registration_requests')
    .select('full_name, description')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Upsert the caller's own request. The `onConflict: 'id'` update path is
 * how a user revises a submission before an admin acts on it
 * (RLS-62). `full_name` is trimmed; a blank `description` is stored as
 * `null` rather than an empty string.
 */
export async function submitRegistrationRequest(params: {
  id: string
  full_name: string
  description: string | null
}): Promise<void> {
  const description = params.description?.trim()
  const { error } = await supabase.from('registration_requests').upsert(
    {
      id: params.id,
      full_name: params.full_name.trim(),
      description: description ? description : null,
    },
    { onConflict: 'id' },
  )
  if (error) throw error
}

/**
 * The name to show in the form on first load: a previously submitted
 * name wins, otherwise whatever the Google profile handed us at sign-in
 * (`user_metadata.full_name`, falling back to `name`), otherwise empty.
 * The user edits it freely before submitting — this is only the default.
 */
export function initialRegistrationName(
  existing: MyRegistrationRequest | null,
  session: Session | null,
): string {
  if (existing) return existing.full_name
  const meta = (session?.user.user_metadata ?? {}) as Record<string, unknown>
  const fromGoogle = meta.full_name ?? meta.name
  return typeof fromGoogle === 'string' ? fromGoogle : ''
}

/**
 * True when a `registration_requests` write failed *because the caller
 * is now registered* — the `registration_requests_self_insert` policy's
 * `not exists (public.users …)` guard rejecting with `42501`. It means
 * an admin approved the account between the screen loading and the
 * submit; the right response is to reload into the app, not to show an
 * error.
 */
export function isAlreadyRegisteredError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '42501'
  )
}
