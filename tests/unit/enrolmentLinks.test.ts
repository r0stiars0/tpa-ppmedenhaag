import { describe, expect, it } from 'vitest'
import {
  PARENT_LINK_ROLES,
  TUTOR_LINK_ROLES,
  mayBeNamedAsParent,
  mayBeNamedAsTutor,
  selfLoginAccountsToOffer,
  type LinkableAccount,
} from '../../src/lib/enrolmentLinks'
import type { Database } from '../../src/lib/database.types'

type UserRole = Database['public']['Enums']['user_role']

/**
 * All four, swept rather than sampled — the same discipline
 * `viewScope.test.ts` applies to the capability lattice. A list of
 * offered roles can only ever demonstrate the entries it names, and the
 * entries that matter here are the ones somebody might quietly add or
 * drop later.
 */
const ALL_ROLES: UserRole[] = ['admin', 'tutor', 'parent', 'student']

describe('who an admin may be offered for an enrolment link (ADR-028)', () => {
  it('covers every role in the enum, so nothing is left undecided', () => {
    for (const role of ALL_ROLES) {
      expect(typeof mayBeNamedAsParent(role), role).toBe('boolean')
      expect(typeof mayBeNamedAsTutor(role), role).toBe('boolean')
    }
  })

  it('offers a tutor and an admin as a child’s parent', () => {
    // ADR-024: PPME's decision that a teacher of the class their own
    // child attends is the ordinary arrangement at a small TPA. Leaving
    // these two out is what made Ustadzah Aminah, Bapak Hasan and
    // Ustadzah Laila creatable only in SQL (ADR-025(f)).
    expect(mayBeNamedAsParent('tutor')).toBe(true)
    expect(mayBeNamedAsParent('admin')).toBe(true)
    expect(mayBeNamedAsParent('parent')).toBe(true)
  })

  it('does not offer a santri as another child’s parent', () => {
    // The one deliberate omission. The database permits it — this is a
    // dropdown, not a policy — but nothing in the record asks for it,
    // and attaching a child's whole record to a teenager should take a
    // decision rather than a mis-click (DPIA R12).
    expect(mayBeNamedAsParent('student')).toBe(false)
  })

  it('offers a 16+ santri as a tutor', () => {
    // ADR-020, and RLS-35 pins the grant that follows. Aisyah assists
    // the class she attends; until ADR-028 no admin screen could set
    // that up, which is why ADR-020(d) recorded her entitlement as
    // unreachable.
    expect(mayBeNamedAsTutor('student')).toBe(true)
  })

  it('offers everyone else as a tutor too', () => {
    expect(mayBeNamedAsTutor('tutor')).toBe(true)
    expect(mayBeNamedAsTutor('admin')).toBe(true)
    // A parent who starts helping with a class is named in `tutor_ids`
    // and holds the tutor grant from that moment, with no profile edit
    // (ADR-019) — so the picker has to offer them.
    expect(mayBeNamedAsTutor('parent')).toBe(true)
  })

  it('keeps the predicates and the lists saying the same thing', () => {
    // Two ways to express one rule is two ways for it to drift; the
    // queries use the arrays and the tests above use the predicates.
    for (const role of ALL_ROLES) {
      expect(mayBeNamedAsParent(role), role).toBe(PARENT_LINK_ROLES.includes(role))
      expect(mayBeNamedAsTutor(role), role).toBe(TUTOR_LINK_ROLES.includes(role))
    }
  })

  it('names no role that is not in the enum', () => {
    // A typo'd role would silently narrow a picker: `in ('tutorr')`
    // returns nobody and the screen just looks empty.
    for (const role of [...PARENT_LINK_ROLES, ...TUTOR_LINK_ROLES]) {
      expect(ALL_ROLES, role).toContain(role)
    }
  })

  it('leaves the tutor link wider than the parent link, and says which way', () => {
    // The asymmetry is the whole design: every role may teach, not
    // every role may be a parent contact. Asserted as a relationship
    // rather than as two lists, so reversing one of them fails here.
    for (const role of PARENT_LINK_ROLES) {
      expect(TUTOR_LINK_ROLES, role).toContain(role)
    }
    expect(TUTOR_LINK_ROLES.length).toBeGreaterThan(PARENT_LINK_ROLES.length)
  })
})

/**
 * `selfLoginAccountsToOffer` (TAD ADR-032) — the edit-form counterpart
 * to the create-form picker above: what to offer when a student being
 * edited may already have a self-login linked, which the "unlinked"
 * pool (by construction) excludes.
 */
describe('selfLoginAccountsToOffer (ADR-032 — editing a student’s self-login link)', () => {
  const pending: LinkableAccount = {
    id: 'user-pending',
    full_name: 'Ali Rahman',
    email: 'ali.new@dev.local',
    role: 'student',
  }

  it('passes the pool through unchanged when the student has no self-login yet', () => {
    expect(selfLoginAccountsToOffer([pending], null)).toEqual([pending])
  })

  it('passes the pool through unchanged when the current link is already in it', () => {
    // Shouldn't happen given how `fetchUnlinkedStudentAccounts` is
    // built (an account linked to *this* student is excluded from the
    // pool precisely because it's linked), but the function must not
    // duplicate the option if it ever does.
    const already: LinkableAccount = {
      id: 'user-already-present',
      full_name: 'Zainab',
      email: 'zainab@dev.local',
      role: 'student',
    }
    expect(selfLoginAccountsToOffer([pending, already], already)).toEqual([pending, already])
  })

  it('restores the student’s own currently-linked account to the front of the pool', () => {
    const current = { id: 'user-current', full_name: 'Fatimah', email: 'fatimah@dev.local' }
    const result = selfLoginAccountsToOffer([pending], current)
    expect(result).toEqual([{ ...current, role: 'student' }, pending])
  })

  it('offers exactly the restored account when nothing else is pending', () => {
    const current = { id: 'user-current', full_name: 'Fatimah', email: 'fatimah@dev.local' }
    expect(selfLoginAccountsToOffer([], current)).toEqual([{ ...current, role: 'student' }])
  })

  it('does not mutate the pool it was given', () => {
    const pool = [pending]
    const current = { id: 'user-current', full_name: 'Fatimah', email: 'fatimah@dev.local' }
    selfLoginAccountsToOffer(pool, current)
    expect(pool).toEqual([pending])
  })
})
