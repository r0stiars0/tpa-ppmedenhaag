/**
 * Extracts a human-readable message from a thrown value. Handles real
 * `Error` instances and error-shaped objects that carry a string
 * `.message` but aren't `instanceof Error` — notably Supabase's
 * PostgrestError in some client versions. A bare `String(err)` on a
 * plain object silently produces the useless literal "[object Object]"
 * instead of the actual error text (caught in production: a failed RPC
 * call rendered "[object Object]" in the Registrations page instead of
 * the real Postgres error).
 */
/** Postgres SQLSTATE for a unique-constraint violation. */
export const POSTGRES_UNIQUE_VIOLATION = '23505'

/**
 * Whether a thrown value is a Postgres unique-constraint violation
 * (SQLSTATE 23505) — a PostgrestError carrying `code: '23505'`.
 *
 * Two callers rely on this being one shared definition: `offlineReplay`
 * treats it as "this write already landed on an earlier attempt, only
 * the response was lost" and succeeds; `FamilyMurajaahView` treats a
 * same-day `murajaah_log` collision from a *second guardian* (ADR-040,
 * `unique (assignment_id, date)`) as "already confirmed today" rather
 * than an error.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  )
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message
  }
  // A bare object with no .message would otherwise stringify to the
  // useless literal "[object Object]" (String()'s default coercion) —
  // dump its JSON instead so there's still something to act on.
  if (typeof err === 'object' && err !== null) {
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}
