import { useState } from 'react'
import { getErrorMessage } from '../lib/errors'
import { FIXTURE_USERS, signInAsFixtureUser } from './devAuth'

/**
 * Rendered only in `npm run dev` (see SignIn.tsx) — lets you sign in as a
 * seeded fixture user against a local `supabase start` stack without real
 * Google OAuth. No-op / harmless to leave imported since the whole branch
 * is stripped from production builds (`import.meta.env.DEV` is statically
 * false there).
 */
export function DevAuthSwitcher() {
  const [signingInAs, setSigningInAs] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleClick(userId: string) {
    setSigningInAs(userId)
    setError(null)
    try {
      await signInAsFixtureUser(userId)
    } catch (err) {
      setError(getErrorMessage(err))
      setSigningInAs(null)
    }
  }

  return (
    <div className="mt-8 w-full max-w-xs rounded-lg border-2 border-dashed border-ppme-accent/50 bg-ppme-accent/5 p-4 text-left">
      <p className="text-xs font-bold uppercase tracking-wide text-ppme-accent">
        Dev only — local fixture sign-in
      </p>
      <p className="mt-1 text-xs text-ppme-text/60">
        Bypasses Google OAuth against the local Supabase stack. Never shown in production.
      </p>
      <div className="mt-3 space-y-1.5">
        {FIXTURE_USERS.map((u) => (
          <button
            key={u.id}
            type="button"
            disabled={signingInAs !== null}
            onClick={() => void handleClick(u.id)}
            className="min-h-11 w-full rounded-md border border-black/10 bg-white px-3 text-left text-sm font-medium text-ppme-text hover:bg-ppme-bg-alt disabled:opacity-50"
          >
            {signingInAs === u.id ? '…' : u.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-ppme-danger">{error}</p>}
    </div>
  )
}
