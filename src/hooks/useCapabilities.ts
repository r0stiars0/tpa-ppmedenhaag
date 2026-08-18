import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import {
  fetchViewerRelationships,
  NO_CAPABILITIES,
  type Capabilities,
} from '../lib/capabilities'
import { getErrorMessage } from '../lib/errors'

/**
 * What the signed-in person can do, derived from their relationships
 * rather than from `users.role` (TAD ADR-019), plus which student
 * record — if any — is their own.
 *
 * Introduced with no consumer in ADR-019 and deliberately so: swapping
 * the screens' `role ===` checks for capabilities is a behaviour change
 * rather than a refactor, and *which* view a dual-role person lands on
 * was a UI question that change did not answer. ADR-025 answers it.
 * `ViewScopeProvider` is now the main consumer — it resolves a
 * `ViewScope` from these booleans and the role fallback — and the
 * notification bell, centre and settings screen each read the family
 * half through `canReceiveNotifications` (ADR-022).
 *
 * `NO_CAPABILITIES` while loading is the safe default in both
 * directions: it grants nothing, and because capabilities only decide
 * what to offer — never what data comes back — the worst it can do is
 * show a screen a moment late. `resolveScope` falls back to the role
 * label in exactly that window, which is why a single-role user never
 * sees the wrong view flash past on the way to the right one.
 */
export function useCapabilities() {
  const { session, profile, loading: authLoading } = useAuth()
  const userId = session?.user.id ?? null
  const role = profile?.role ?? null

  const [capabilities, setCapabilities] = useState<Capabilities>(NO_CAPABILITIES)
  const [selfStudentId, setSelfStudentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setCapabilities(NO_CAPABILITIES)
      setSelfStudentId(null)
      setLoading(authLoading)
      return
    }

    let active = true
    setLoading(true)
    fetchViewerRelationships(supabase, userId, role)
      .then((next) => {
        if (!active) return
        setCapabilities(next.capabilities)
        setSelfStudentId(next.selfStudentId)
        setError(null)
      })
      .catch((err) => {
        if (!active) return
        setCapabilities(NO_CAPABILITIES)
        setSelfStudentId(null)
        setError(getErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [userId, role, authLoading])

  return { capabilities, selfStudentId, loading, error }
}
