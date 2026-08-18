/**
 * Who this system sends notifications to — and, because a push
 * subscription is itself personal data, who it will store one for.
 *
 * ── The rule is a relationship, never a role (TAD ADR-022) ──────────
 * Every notification this system sends is *about a child*, so the only
 * question that decides a recipient is what the account's relationship
 * to that child is: `students.parent_id`, or `students.user_id` for a
 * 16+ santri with their own login. Nothing here consults `users.role`.
 *
 * That is a correction, not a restatement. The rule used to be
 * `role in ('parent','student')` (ADR-015(a)), which quietly meant that
 * a tutor whose own child attends the TPA — and the TPA has several —
 * received nothing about their own child: no push, no email, no in-app
 * row, and no way to store a subscription in the first place. Silent,
 * and indistinguishable from a quiet week.
 *
 * ── What ADR-015(a) got right, and still governs ────────────────────
 * The half that survives is about a tutor's *class*: subscribing one
 * account to two hundred children's lock screens is indefensible under
 * data minimisation, and a tutor learns about an absence by recording
 * it. That half is not enforced here at all — it is enforced by the
 * shape of the audience query, which pairs a child only with that
 * child's own `parent_id`/`user_id`. A tutor is not in either column
 * for the children they teach, so no notification about them can reach
 * a tutor whatever this predicate answers. The two halves are enforced
 * in different places precisely so neither can be lost by editing the
 * other.
 *
 * ── Why the predicate takes booleans rather than a user ─────────────
 * The same question is asked in five places — `push-subscribe`, the
 * settings screen, the bell, the notification centre, and (implicitly)
 * the audience builder — across the browser and a Netlify Function,
 * against two different Supabase clients. A predicate over two derived
 * booleans is the largest piece all five can share; the derivation
 * itself lives once in `capabilities.ts#familyRelationships`, which is
 * also where `Capabilities` gets the same two fields, so a `Capabilities`
 * value satisfies this interface structurally.
 *
 * Deliberately dependency-free — no imports at all — so that both the
 * browser bundle and `netlify/functions/` can hold the one copy of the
 * rule.
 */
export interface RecipientRelationships {
  /** Named as `parent_id` on at least one student row. */
  isParentOfAnyone: boolean
  /** A 16+ santri whose own `students.user_id` is this account. */
  isSelfStudent: boolean
}

export function canReceiveNotifications(who: RecipientRelationships): boolean {
  return who.isParentOfAnyone || who.isSelfStudent
}
