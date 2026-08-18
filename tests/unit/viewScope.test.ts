import { describe, expect, it } from 'vitest'
import { NO_CAPABILITIES, type Capabilities } from '../../src/lib/capabilities'
import { NAV_TABS } from '../../src/components/tabs'
import { ROLE_I18N_KEY } from '../../src/lib/roleLabels'
import {
  availableScopes,
  canSwitchScope,
  capabilityLabelKeys,
  familyScopeLabelKey,
  hasClassScope,
  hasFamilyScope,
  resolveScope,
  scopeAppliesTo,
  scopeFallbackForRole,
  scopeLabelKey,
  type ViewScope,
} from '../../src/lib/viewScope'

type UserRole = 'admin' | 'tutor' | 'parent' | 'student'

const ROLES: UserRole[] = ['admin', 'tutor', 'parent', 'student']

function caps(over: Partial<Capabilities> = {}): Capabilities {
  return { ...NO_CAPABILITIES, ...over }
}

/**
 * The lattice, not a selection from it — the treatment
 * `capabilities.test.ts` gives `deriveCapabilities`, applied to the
 * function that decides which screen a person gets.
 *
 * Sixteen capability combinations against all four roles is 64 cells,
 * and the property under test is a conditional one that a hand-picked
 * list cannot demonstrate: `users.role` may decide the answer in
 * exactly the four cells where the person holds no relationship at all,
 * and must be ignored in the other sixty. That branch is not a
 * leftover — it is what keeps a `role='tutor'` account an admin has not
 * yet put in a class on the tutor screens it has today (ADR-019(d)) —
 * so it cannot simply be asserted away, only fenced.
 *
 * Each non-empty cell is therefore run against every role, including
 * the role that would give the opposite answer if anything read it.
 */
describe('resolveScope — the sixteen capability combinations against all four roles', () => {
  const cells = [false, true]
  const combinations = cells.flatMap((isAdmin) =>
    cells.flatMap((isTutorOfAnyClass) =>
      cells.flatMap((isParentOfAnyone) =>
        cells.map((isSelfStudent) => ({
          isAdmin,
          isTutorOfAnyClass,
          isParentOfAnyone,
          isSelfStudent,
        })),
      ),
    ),
  )

  const matrix = combinations.flatMap((capabilities) =>
    ROLES.map((role) => ({ capabilities, role })),
  )

  it('covers all sixty-four cells', () => {
    expect(matrix).toHaveLength(64)
  })

  it.each(matrix)(
    'admin=$capabilities.isAdmin tutor=$capabilities.isTutorOfAnyClass parent=$capabilities.isParentOfAnyone self=$capabilities.isSelfStudent as $role',
    ({ capabilities, role }) => {
      const scopes = availableScopes(capabilities)
      const resolved = resolveScope({ capabilities, role, preferred: null })

      if (scopes.length === 0) {
        // The only cells the role column may decide, and it decides them
        // with the exact expression the six pages carried before
        // ADR-025.
        expect(resolved).toBe(scopeFallbackForRole(role))
        return
      }

      // Everywhere else the answer comes from the relationships alone,
      // and is identical for all four roles — which is the claim, since
      // for most of these cells the role column says the opposite.
      expect(resolved).toBe(scopes[0])
      expect(new Set(ROLES.map((r) => resolveScope({ capabilities, role: r, preferred: null })))).
        toEqual(new Set([resolved]))
    },
  )

  it('offers the class scope on a tutor relationship or the admin grant, and nothing else', () => {
    expect(hasClassScope(caps({ isTutorOfAnyClass: true }))).toBe(true)
    expect(hasClassScope(caps({ isAdmin: true }))).toBe(true)
    expect(hasClassScope(caps({ isParentOfAnyone: true, isSelfStudent: true }))).toBe(false)
  })

  it('offers the family scope on either family relationship, and nothing else', () => {
    // Both halves matter: a 16+ santri has no `parent_id` row of their
    // own, so a parent-only reading would leave them with no scope at
    // all and hand them the class shape by the role fallback.
    expect(hasFamilyScope(caps({ isParentOfAnyone: true }))).toBe(true)
    expect(hasFamilyScope(caps({ isSelfStudent: true }))).toBe(true)
    expect(hasFamilyScope(caps({ isTutorOfAnyClass: true, isAdmin: true }))).toBe(false)
  })
})

describe('canSwitchScope — the only thing that renders the switch', () => {
  it('is false for every account that holds one relationship', () => {
    // The four personas the dev fixture seeds as single-role, and the
    // regression this whole PR is about: a pure parent must see no
    // control and no change whatsoever.
    expect(canSwitchScope(caps({ isParentOfAnyone: true }))).toBe(false) // Ibu Siti
    expect(canSwitchScope(caps({ isTutorOfAnyClass: true }))).toBe(false) // Ustadz Baru
    expect(canSwitchScope(caps({ isSelfStudent: true }))).toBe(false) // Fatimah
    expect(canSwitchScope(caps({ isAdmin: true }))).toBe(false) // Admin Dev
  })

  it('is false for an account with no relationship at all', () => {
    // The not-yet-assigned tutor. They hold no scope, get the role
    // fallback, and must not be offered a choice between one thing.
    expect(canSwitchScope(NO_CAPABILITIES)).toBe(false)
    expect(availableScopes(NO_CAPABILITIES)).toEqual([])
  })

  it('is false when both capabilities point at the same scope', () => {
    // An admin who also teaches — Ustadzah Laila without her daughter.
    // Two capabilities, one scope, so there is nothing to switch
    // between: counting capabilities instead of scopes would have shown
    // her a control with one button.
    expect(canSwitchScope(caps({ isAdmin: true, isTutorOfAnyClass: true }))).toBe(false)
    // …and likewise a parent whose own 16+ record is also enrolled.
    expect(canSwitchScope(caps({ isParentOfAnyone: true, isSelfStudent: true }))).toBe(false)
  })

  it('is true for each of the fixture personas that hold both', () => {
    // Ustadzah Aminah (disjoint) and Bapak Hasan (overlap) — the
    // overlap is a bigger union, not a different capability set, so
    // both reach the same answer (ADR-024(a)).
    expect(canSwitchScope(caps({ isTutorOfAnyClass: true, isParentOfAnyone: true }))).toBe(true)
    // Ustadzah Laila: admin, tutor and parent at once (RLS-34).
    expect(
      canSwitchScope(caps({ isAdmin: true, isTutorOfAnyClass: true, isParentOfAnyone: true })),
    ).toBe(true)
    // Aisyah: the student assistant, whose entitlement has been
    // unreachable in the product since ADR-020(d).
    expect(canSwitchScope(caps({ isSelfStudent: true, isTutorOfAnyClass: true }))).toBe(true)
  })
})

describe('resolveScope — what a person last chose', () => {
  const both = caps({ isTutorOfAnyClass: true, isParentOfAnyone: true })

  it('defaults to the class scope, which is the one with a deadline', () => {
    expect(resolveScope({ capabilities: both, role: 'parent', preferred: null })).toBe('class')
  })

  it('honours a scope they still hold', () => {
    expect(resolveScope({ capabilities: both, role: 'tutor', preferred: 'family' })).toBe('family')
    expect(resolveScope({ capabilities: both, role: 'parent', preferred: 'class' })).toBe('class')
  })

  it('drops a scope whose relationship has gone', () => {
    // An ustadzah taken off her last class mid-session. A preference
    // cannot outlive the relationship behind it, or she is left on an
    // empty class picker with a control that will not move her.
    expect(
      resolveScope({
        capabilities: caps({ isParentOfAnyone: true }),
        role: 'tutor',
        preferred: 'class',
      }),
    ).toBe('family')
  })

  it('ignores a preference entirely when no relationship is held', () => {
    // Nothing to prefer between, and the role fallback has to win or a
    // not-yet-assigned tutor could be moved off their own screens.
    expect(
      resolveScope({ capabilities: NO_CAPABILITIES, role: 'tutor', preferred: 'family' }),
    ).toBe('class')
  })
})

describe('scopeFallbackForRole — the pre-ADR-025 expression, preserved verbatim', () => {
  it('reproduces the isManager idiom the six pages carried', () => {
    // `profile?.role === 'tutor' || profile?.role === 'admin'`.
    expect(scopeFallbackForRole('tutor')).toBe('class')
    expect(scopeFallbackForRole('admin')).toBe('class')
    expect(scopeFallbackForRole('parent')).toBe('family')
    expect(scopeFallbackForRole('student')).toBe('family')
    expect(scopeFallbackForRole(null)).toBe('family')
  })
})

describe('scopeLabelKey — labelled by subject, never by role (PRD §70)', () => {
  it('never returns a role label', () => {
    // The switch must not reintroduce "Pilih Peran" by caption. Every
    // key it can produce lives in the `scope` namespace; the `roles`
    // namespace is what the dashboard line uses, and the two are kept
    // apart on purpose.
    const everyCombination: Capabilities[] = [
      caps({ isTutorOfAnyClass: true, isParentOfAnyone: true }),
      caps({ isTutorOfAnyClass: true, isSelfStudent: true }),
      caps({ isAdmin: true, isParentOfAnyone: true }),
      caps({ isAdmin: true, isParentOfAnyone: true, isSelfStudent: true }),
    ]
    const roleKeys = new Set(Object.values(ROLE_I18N_KEY))
    for (const capabilities of everyCombination) {
      for (const scope of ['class', 'family'] as ViewScope[]) {
        const key = scopeLabelKey(scope, capabilities)
        expect(key.startsWith('scope.')).toBe(true)
        expect(roleKeys.has(key)).toBe(false)
      }
    }
  })

  it('names the family scope after the relationship behind it', () => {
    expect(familyScopeLabelKey(caps({ isParentOfAnyone: true }))).toBe('scope.myChild')
    expect(familyScopeLabelKey(caps({ isSelfStudent: true }))).toBe('scope.myself')
    // Both at once: their family screens carry a picker holding their
    // children *and* their own record, so neither of the other two
    // labels would be true of what is behind the button.
    expect(familyScopeLabelKey(caps({ isParentOfAnyone: true, isSelfStudent: true }))).toBe(
      'scope.myFamily',
    )
  })

  it('always calls the class scope by the same name', () => {
    expect(scopeLabelKey('class', caps({ isAdmin: true }))).toBe('scope.myClass')
    expect(scopeLabelKey('class', caps({ isTutorOfAnyClass: true }))).toBe('scope.myClass')
  })
})

describe('scopeAppliesTo — the routes a scope changes', () => {
  it('covers every operational tab plus Rapor', () => {
    // Pinned against `NAV_TABS` rather than restated, so adding a
    // two-shaped screen to the tab bar without teaching the switch
    // about it fails here instead of shipping a screen whose shape
    // nobody can change.
    for (const tab of NAV_TABS) {
      expect(scopeAppliesTo(tab.to)).toBe(true)
    }
    expect(scopeAppliesTo('/reports')).toBe(true)
  })

  it('stays off the screens that render the same thing either way', () => {
    expect(scopeAppliesTo('/')).toBe(false)
    expect(scopeAppliesTo('/settings/notifications')).toBe(false)
    expect(scopeAppliesTo('/notifications')).toBe(false)
    // Especially the enrollment section, where a family half does not
    // exist and a control offering one would be a lie about the screen.
    expect(scopeAppliesTo('/admin')).toBe(false)
    expect(scopeAppliesTo('/admin/students')).toBe(false)
  })

  it('does not match a route that merely starts with the same letters', () => {
    expect(scopeAppliesTo('/reports-archive')).toBe(false)
    expect(scopeAppliesTo('/attendance-summary')).toBe(false)
  })
})

describe('capabilityLabelKeys — the dashboard line that used to name one role', () => {
  it('renders exactly what it rendered before for every single-relationship account', () => {
    // The regression bar for this PR: a pure parent sees no change
    // whatsoever, and that includes the one line of text under their
    // name.
    expect(capabilityLabelKeys(caps({ isParentOfAnyone: true }), 'parent')).toEqual([
      'roles.orangTua',
    ])
    expect(capabilityLabelKeys(caps({ isTutorOfAnyClass: true }), 'tutor')).toEqual(['roles.ustadz'])
    expect(capabilityLabelKeys(caps({ isSelfStudent: true }), 'student')).toEqual(['roles.santri'])
    expect(capabilityLabelKeys(caps({ isAdmin: true }), 'admin')).toEqual(['roles.admin'])
  })

  it('falls back to the role label when no relationship is held yet', () => {
    // A tutor invited but not yet assigned to a class would otherwise
    // be described as nothing at all — a blank line where their role
    // used to be, on the first screen they ever see.
    expect(capabilityLabelKeys(NO_CAPABILITIES, 'tutor')).toEqual(['roles.ustadz'])
    expect(capabilityLabelKeys(NO_CAPABILITIES, 'parent')).toEqual(['roles.orangTua'])
    expect(capabilityLabelKeys(NO_CAPABILITIES, null)).toEqual([])
  })

  it('lists every relationship a multi-role account holds, in a fixed order', () => {
    // Bapak Hasan, whose role column says `parent` while he teaches two
    // classes — the line that used to state the assumption this PR is
    // about.
    expect(
      capabilityLabelKeys(caps({ isTutorOfAnyClass: true, isParentOfAnyone: true }), 'parent'),
    ).toEqual(['roles.ustadz', 'roles.orangTua'])
    // Aisyah: assists two classes, and her own record is in one of them.
    expect(
      capabilityLabelKeys(caps({ isTutorOfAnyClass: true, isSelfStudent: true }), 'student'),
    ).toEqual(['roles.ustadz', 'roles.santri'])
    // Ustadzah Laila, all three at once.
    expect(
      capabilityLabelKeys(
        caps({ isAdmin: true, isTutorOfAnyClass: true, isParentOfAnyone: true }),
        'admin',
      ),
    ).toEqual(['roles.admin', 'roles.ustadz', 'roles.orangTua'])
  })

  it('never echoes the role column once a relationship exists', () => {
    // The same discipline `capabilities.test.ts` applies to the
    // derivation: the role is set to whatever would be wrong.
    expect(capabilityLabelKeys(caps({ isParentOfAnyone: true }), 'tutor')).toEqual([
      'roles.orangTua',
    ])
    expect(capabilityLabelKeys(caps({ isSelfStudent: true }), 'admin')).toEqual(['roles.santri'])
  })
})
