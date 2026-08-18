import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { useViewScope } from '../context/ViewScopeContext'
import { scopeAppliesTo, scopeLabelKey } from '../lib/viewScope'

/**
 * The control a person with more than one relationship uses to say
 * which of them the screen is about (TAD ADR-025).
 *
 * ── Labelled by subject, never by role ──────────────────────────────
 * "Grup saya" / "Anak saya", not "Ustadz" / "Orang Tua". PRD §70
 * records that the prototype's "Pilih Peran" switcher is not a feature
 * to build, because production derives role from the authenticated
 * user rather than letting anyone pick one — and that objection is
 * kept. Nothing here offers a role: the options are the relationships
 * this account already holds, `canSwitch` is false unless it holds two,
 * and picking one changes which query a screen runs, not who the person
 * is. A control captioned with a role name would claim otherwise even
 * though the code did not, which is why the caption is the thing that
 * changed.
 *
 * ── Renders nothing for almost everybody ────────────────────────────
 * Two independent gates, and both have to pass. `canSwitch` is
 * `availableScopes(...).length > 1`, so a pure parent, a pure tutor, a
 * 16+ santri who assists nothing and a pure admin never reach the
 * markup at all — no control, no wrapper, no changed spacing.
 * `scopeAppliesTo` then keeps it off the routes where scope changes
 * nothing (the dashboard, settings, the notification centre, and every
 * `/admin/*` screen), because a visible control that does nothing when
 * pressed is worse than none.
 *
 * ── Colour ──────────────────────────────────────────────────────────
 * Primary blue for the selected segment. Gold is reserved for
 * achievement moments and red for absence (checklist §5, and the
 * notification tone tests pin both) — a navigation control has no claim
 * on either.
 *
 * `min-h-11` on each segment, and two short words per label in both
 * locales: the longest Dutch string here is "Mijn gezin", which fits a
 * half-width segment at 390px with room to spare.
 *
 * ── Two placements, one component ───────────────────────────────────
 * `className` carries the placement because the two are genuinely
 * different: on desktop it sits at the right-hand end of the tab row,
 * which is where `DesktopTabs` already puts the one control that has
 * horizontal room for it; on mobile the bottom nav has no room at all —
 * five 44px targets is what fits (ADR-014, `tabs.test.ts`) — so it sits
 * above the content instead. Returning `null` before any wrapper is
 * what keeps a single-relationship account's layout byte-identical:
 * there is no empty band to space out around.
 */
export function ScopeSwitch({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { scope, setScope, available, canSwitch, capabilities } = useViewScope()

  if (!canSwitch || !scopeAppliesTo(pathname)) return null

  return (
    <div
      role="group"
      aria-label={t('scope.label')}
      className={`flex gap-1 rounded-lg bg-black/5 p-1 ${className}`}
    >
      {available.map((option) => {
        const active = option === scope
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => setScope(option)}
            className={`min-h-11 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition-colors ${
              active
                ? 'bg-ppme-primary text-white shadow-sm'
                : 'text-ppme-text/70 hover:bg-white/70'
            }`}
          >
            {t(scopeLabelKey(option, capabilities))}
          </button>
        )
      })}
    </div>
  )
}
