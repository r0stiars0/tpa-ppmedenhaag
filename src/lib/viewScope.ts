import type { Database } from './database.types'
import type { Capabilities } from './capabilities'
import { ROLE_I18N_KEY } from './roleLabels'

type UserRole = Database['public']['Enums']['user_role']

/**
 * Which of a person's own relationships a screen is currently about
 * (TAD ADR-025).
 *
 * Six screens — Hadir, Tugas, Yanbu'a, Al-Quran, Murajaah, Rapor — each
 * come in two shapes: a **class** shape (pick a class, work through its
 * roster, record) and a **family** shape (pick a child, read their
 * history, confirm home practice). Until now the shape was chosen by
 * `profile.role === 'tutor' || profile.role === 'admin'`, which is
 * correct only for someone who is one thing. A tutor whose own child
 * attends is two things, and the role label silently picked one of them
 * for her — the consequence ADR-019(d) recorded and deferred to here.
 *
 * ── This is not the switcher PRD §70 rejected ───────────────────────
 * The Figma Make prototype carried a top-level "Pilih Peran" control
 * offering Ustadz / Orang Tua / Santri to anyone, so that one prototype
 * could demo all three role views; the PRD notes it is prototype-only
 * because "in production, role is derived from the authenticated user".
 * That objection is kept, not reversed. A `ViewScope` is *not* a role
 * and cannot be assumed: `availableScopes` offers only the scopes the
 * signed-in account's own relationships already entitle it to, derived
 * from the same predicates the RLS policies use. Choosing one changes
 * which question a screen asks, never what comes back — RLS is
 * untouched, and a scope that said yes where a policy says no produces
 * an empty screen, exactly as ADR-019(b) says of capabilities. The
 * control is therefore labelled by *subject* ("Grup saya" / "Anak
 * saya"), never by role, so nothing in the product claims a person can
 * choose what they are.
 *
 * ── Why the role column still appears below ─────────────────────────
 * `resolveScope` consults `users.role` in exactly one branch: when the
 * person holds no relationship at all. That is not a leftover, it is
 * the thing that keeps this change invisible to existing users. A
 * `role='tutor'` account an admin has not yet put in a class holds no
 * capability whatsoever, and today lands on the tutor view with an
 * empty class picker and "no classes assigned"; a purely
 * capability-derived answer would move them to the family views and
 * take their screens away. ADR-019(d) named this account as the reason
 * the capability swap could not be a refactor. `scopeFallbackForRole`
 * reproduces the old `isManager` expression exactly, and
 * `tests/unit/viewScope.test.ts` sweeps all sixteen capability
 * combinations against all four roles to assert the role is echoed in
 * those four cells and nowhere else.
 */
export type ViewScope = 'class' | 'family'

/**
 * The class shape is offered to anyone who teaches a class, and to an
 * admin — who is normally in no `tutor_ids` array at all, and reaches
 * every class through `fn_is_admin()` instead (ADR-014, and the admin
 * branch of `fetchTaughtClasses`).
 */
export function hasClassScope(capabilities: Capabilities): boolean {
  return capabilities.isTutorOfAnyClass || capabilities.isAdmin
}

/**
 * The family shape is offered on the two family relationships, and on
 * neither anything else — the same pair `canReceiveNotifications` is a
 * predicate over (ADR-022). A 16+ santri's own record reaches the same
 * screens their parent's does; that is what `isSelfStudent` is for.
 */
export function hasFamilyScope(capabilities: Capabilities): boolean {
  return capabilities.isParentOfAnyone || capabilities.isSelfStudent
}

/**
 * The scopes a person's relationships entitle them to, in the order the
 * switch renders them. Class first: it is the scope with a deadline
 * (the register is taken while the class is in the room), and it is the
 * scope every account that holds it lands on today.
 */
export function availableScopes(capabilities: Capabilities): ViewScope[] {
  const scopes: ViewScope[] = []
  if (hasClassScope(capabilities)) scopes.push('class')
  if (hasFamilyScope(capabilities)) scopes.push('family')
  return scopes
}

/**
 * Whether to render the switch at all — **the only thing that decides
 * it**, so that a person who is one thing can never be shown a control
 * offering them a second.
 *
 * A pure parent, a pure tutor, a 16+ santri who assists nothing and a
 * pure admin all hold exactly one scope and get no control, no extra
 * markup and no changed layout.
 */
export function canSwitchScope(capabilities: Capabilities): boolean {
  return availableScopes(capabilities).length > 1
}

/**
 * The pre-capability answer, preserved verbatim: this is the expression
 * that stood in six pages as `profile?.role === 'tutor' ||
 * profile?.role === 'admin'`, and it is now reachable only for someone
 * holding no relationship at all (and for the moment before the two
 * relationship queries return, which is why a single-role user never
 * sees a different screen flash past).
 */
export function scopeFallbackForRole(role: UserRole | null): ViewScope {
  return role === 'tutor' || role === 'admin' ? 'class' : 'family'
}

/**
 * The scope a screen should render, given who the person is and what
 * they last chose.
 *
 * `preferred` is honoured only if they still hold it — a scope cannot
 * outlive the relationship behind it, so an ustadzah removed from her
 * last class falls back to the family shape on her next screen rather
 * than to an empty class picker she can no longer leave.
 */
export function resolveScope(input: {
  capabilities: Capabilities
  role: UserRole | null
  preferred: ViewScope | null
}): ViewScope {
  const scopes = availableScopes(input.capabilities)
  if (scopes.length === 0) return scopeFallbackForRole(input.role)
  if (input.preferred && scopes.includes(input.preferred)) return input.preferred
  return scopes[0]
}

/**
 * What to call the family scope on the switch, which depends on the
 * relationship behind it rather than on a role: "my child" for a
 * parent, "myself" for a 16+ santri with their own login, and a neutral
 * "my family" for the account that is both — whose family screens carry
 * a picker holding their children *and* their own record, so neither of
 * the other two labels would be true.
 */
export function familyScopeLabelKey(capabilities: Capabilities): string {
  if (capabilities.isParentOfAnyone && capabilities.isSelfStudent) return 'scope.myFamily'
  if (capabilities.isSelfStudent) return 'scope.myself'
  return 'scope.myChild'
}

export function scopeLabelKey(scope: ViewScope, capabilities: Capabilities): string {
  return scope === 'class' ? 'scope.myClass' : familyScopeLabelKey(capabilities)
}

/**
 * The routes where a scope changes what is on screen, and therefore the
 * only ones the switch appears on.
 *
 * Deliberately not every route. The dashboard tiles, the notification
 * screens and `/admin/*` render the same thing in either scope, and a
 * control that visibly changes nothing is worse than no control —
 * particularly on the admin screens, where it would suggest the
 * enrollment section has a family half.
 */
const SCOPED_PATHS = [
  '/attendance',
  '/assignments',
  '/yanbua',
  '/quran',
  '/murajaah',
  '/reports',
] as const

export function scopeAppliesTo(pathname: string): boolean {
  return SCOPED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

/**
 * Every relationship a person holds, as i18n keys, for the one line on
 * the dashboard that used to read a single role label out of
 * `users.role`.
 *
 * That line was the most visible place the one-role-per-person
 * assumption was still stated as fact: it told Bapak Hasan he is
 * "Orang Tua" while he teaches two classes, and Aisyah she is "Santri"
 * while she assists two. It now lists what is actually true, in a fixed
 * order so it never reshuffles between renders.
 *
 * The empty case falls back to the role label, which is what keeps this
 * identical for every account that has one relationship or none —
 * including the not-yet-assigned tutor, who would otherwise be
 * described as nothing at all.
 */
export function capabilityLabelKeys(capabilities: Capabilities, role: UserRole | null): string[] {
  const keys: string[] = []
  if (capabilities.isAdmin) keys.push('roles.admin')
  if (capabilities.isTutorOfAnyClass) keys.push('roles.ustadz')
  if (capabilities.isParentOfAnyone) keys.push('roles.orangTua')
  if (capabilities.isSelfStudent) keys.push('roles.santri')
  if (keys.length > 0) return keys
  return role ? [ROLE_I18N_KEY[role]] : []
}
