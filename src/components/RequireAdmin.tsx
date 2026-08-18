import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * Route guard for the admin-only enrollment pages. Without this, a
 * non-admin visiting /admin/* directly wouldn't see other families' data
 * (RLS still applies to every query on those pages), but they'd see a
 * confusing, partially-broken management UI — e.g. a tutor landing on
 * /admin/classes would see only their own class with disabled-looking
 * create/edit actions that 403 on submit. Redirecting home is simpler
 * and clearer than teaching every admin page to degrade gracefully.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  if (profile?.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}
