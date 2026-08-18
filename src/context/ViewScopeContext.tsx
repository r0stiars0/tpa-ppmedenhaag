import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { useCapabilities } from '../hooks/useCapabilities'
import type { Capabilities } from '../lib/capabilities'
import {
  availableScopes,
  canSwitchScope,
  resolveScope,
  type ViewScope,
} from '../lib/viewScope'

interface ViewScopeValue {
  /** Which shape the six two-shaped screens should render right now. */
  scope: ViewScope
  /** Ignored for a scope the person does not hold — see `resolveScope`. */
  setScope: (scope: ViewScope) => void
  /** In render order; length 1 for every single-relationship account. */
  available: ViewScope[]
  /** The only thing that renders the switch. */
  canSwitch: boolean
  capabilities: Capabilities
  /** The caller's own `students` row, for ADR-023's roster exclusion. */
  selfStudentId: string | null
}

const ViewScopeContext = createContext<ViewScopeValue | undefined>(undefined)

/**
 * One scope for the whole session, held in memory (TAD ADR-025).
 *
 * ── Why one piece of state and not one per screen ───────────────────
 * A tutor-parent who switches to her own child on Hadir means it on
 * Yanbu'a too; she is doing one thing — looking at her son — across
 * several tabs, not answering the same question five times. Per-screen
 * state would make the same person hold two scopes at once and turn the
 * bottom tab bar into a set of five unrelated modes.
 *
 * ── Why it is not persisted ─────────────────────────────────────────
 * `localStorage` was considered and declined. A scope that outlives the
 * session means an ustadzah who browsed her son's progress last week
 * opens the app on Saturday morning, in front of her class, to a screen
 * with no register on it — with the control that explains why sitting
 * above the fold but easy to miss. Defaulting to the class scope every
 * session puts the deadline-bearing job first (`availableScopes` orders
 * it first for the same reason) and costs one tap to leave.
 *
 * ── Why the value is safe before the queries return ─────────────────
 * `useCapabilities` reports `NO_CAPABILITIES` while its two queries are
 * in flight, and `resolveScope` answers that from `users.role` — the
 * exact expression the six pages carried before this change. So a pure
 * parent, a pure tutor, a 16+ santri and an admin render the view they
 * render today from the first frame, with no loading state introduced
 * and no wrong screen flashing past. Only the accounts whose landing
 * screen this PR deliberately changes — a tutor-parent whose role
 * column says `parent`, and the student assistant — can see the family
 * shape for the moment before the relationships land.
 */
export function ViewScopeProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { capabilities, selfStudentId } = useCapabilities()
  const [preferred, setPreferred] = useState<ViewScope | null>(null)

  const role = profile?.role ?? null

  const value = useMemo<ViewScopeValue>(
    () => ({
      scope: resolveScope({ capabilities, role, preferred }),
      setScope: setPreferred,
      available: availableScopes(capabilities),
      canSwitch: canSwitchScope(capabilities),
      capabilities,
      selfStudentId,
    }),
    [capabilities, role, preferred, selfStudentId],
  )

  return <ViewScopeContext.Provider value={value}>{children}</ViewScopeContext.Provider>
}

export function useViewScope(): ViewScopeValue {
  const value = useContext(ViewScopeContext)
  if (!value) throw new Error('useViewScope must be used within a ViewScopeProvider')
  return value
}
