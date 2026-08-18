import { describe, expect, it } from 'vitest'
import { canReceiveNotifications } from '../../src/lib/notificationRecipients'
import {
  NO_CAPABILITIES,
  deriveCapabilities,
  familyRelationships,
  fetchFamilyRelationships,
  type FamilyLink,
} from '../../src/lib/capabilities'

/**
 * The recipient rule, on its own (TAD ADR-022).
 *
 * It used to be `role in ('parent','student')`, and the cases below are
 * mostly the accounts that answer differently now: a tutor whose own
 * child attends, an admin whose own child attends, a tutor of a class
 * and nothing else. `netlify/functions/lib/notifyStudent.ts`'s suite
 * covers the other half of the same decision — who a *given child's*
 * notification is addressed to — because the two are enforced in
 * different places on purpose.
 */
const TUTOR_PARENT = '11111111-1111-4111-8111-111111111111'
const ADMIN_PARENT = '22222222-2222-4222-8222-222222222222'
const STUDENT16 = '33333333-3333-4333-8333-333333333333'
const TUTOR_ONLY = '44444444-4444-4444-8444-444444444444'
const OTHER_PARENT = '55555555-5555-4555-8555-555555555555'

function link(over: Partial<FamilyLink> = {}): FamilyLink {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    full_name: 'Anak',
    parent_id: OTHER_PARENT,
    user_id: null,
    ...over,
  }
}

describe('canReceiveNotifications — a relationship, not a role', () => {
  it('says yes to the parent of a child', () => {
    expect(canReceiveNotifications({ isParentOfAnyone: true, isSelfStudent: false })).toBe(true)
  })

  it('says yes to a 16+ santri with their own login', () => {
    expect(canReceiveNotifications({ isParentOfAnyone: false, isSelfStudent: true })).toBe(true)
  })

  it('says no to an account no student row points at', () => {
    expect(canReceiveNotifications({ isParentOfAnyone: false, isSelfStudent: false })).toBe(false)
  })

  it('takes a Capabilities value unchanged, so the five gates cannot drift', () => {
    // The screens hold a `Capabilities`; `push-subscribe` holds only the
    // two booleans. They are the same two fields by construction —
    // `Capabilities extends RecipientRelationships` — which is what
    // stops the settings screen offering a toggle the Function then
    // 403s, and what stops a bell appearing over an empty list.
    const tutorParent = deriveCapabilities({
      userId: TUTOR_PARENT,
      role: 'tutor',
      familyLinks: [link({ parent_id: TUTOR_PARENT })],
      tutorClassCount: 3,
    })
    expect(canReceiveNotifications(tutorParent)).toBe(true)
    expect(canReceiveNotifications(NO_CAPABILITIES)).toBe(false)
  })
})

describe('who that makes a recipient, by the relationships they hold', () => {
  const yes = (userId: string, links: FamilyLink[]) =>
    canReceiveNotifications(familyRelationships(userId, links))

  it('A TUTOR WHOSE OWN CHILD ATTENDS is a recipient', () => {
    // The bug. `users.role` says tutor; their own child's row names them
    // as `parent_id`. Under the old rule this account could not even
    // store a push subscription, so nothing about their own child could
    // ever reach them — silently.
    expect(yes(TUTOR_PARENT, [link({ parent_id: TUTOR_PARENT })])).toBe(true)
  })

  it('AN ADMIN WHOSE OWN CHILD ATTENDS is a recipient', () => {
    // ADR-014's super admin is about the operational screens. Being an
    // administrator of the TPA is not a reason to stop being told your
    // own child was absent — and it grants nothing about anyone else's,
    // because `notifications_own_read` is `user_id = auth.uid()`
    // (ADR-017(d), pgTAP NC-09/NC-12).
    expect(yes(ADMIN_PARENT, [link({ parent_id: ADMIN_PARENT })])).toBe(true)
  })

  it('A TUTOR WITH NO CHILD OF THEIR OWN is not', () => {
    // The half of ADR-015(a) that survives: a tutor of a class of
    // twenty-five is named on none of those rows, so there is nothing to
    // send them and no reason to store a push endpoint for them.
    // Teaching does not appear in this derivation at all.
    expect(yes(TUTOR_ONLY, [])).toBe(false)
    // …not even when the children they teach are in the rows they can
    // read. Their id is in neither link column of any of them.
    expect(yes(TUTOR_ONLY, [link(), link({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })])).toBe(
      false,
    )
  })

  it('a 16+ santri is a recipient through their own record, not their parent’s', () => {
    // Their row's `parent_id` is their actual parent. Reading "I appear
    // in a students row" as parenthood would make every 16+ account a
    // parent of themselves.
    const own = link({ parent_id: OTHER_PARENT, user_id: STUDENT16 })
    expect(familyRelationships(STUDENT16, [own])).toEqual({
      isParentOfAnyone: false,
      isSelfStudent: true,
    })
    expect(yes(STUDENT16, [own])).toBe(true)
  })

  it('a student assistant is a recipient for their own record only', () => {
    // ADR-020: a 16+ santri who also teaches a class. The tutor half
    // gives them nothing here, exactly as it gives a tutor nothing.
    const own = link({ parent_id: OTHER_PARENT, user_id: STUDENT16 })
    expect(yes(STUDENT16, [own])).toBe(true)
    expect(familyRelationships(STUDENT16, [own]).isParentOfAnyone).toBe(false)
  })

  it('an account with no student row at all is not a recipient', () => {
    // A newly invited tutor or admin, and the state every account passes
    // through between `invite-user` and enrolment. pgTAP NC-18 is the
    // same account at the database: rows exist, and it reads none.
    expect(yes(TUTOR_ONLY, [])).toBe(false)
  })

  it('holds both relationships at once without either standing in for the other', () => {
    // Two booleans have four states and the predicate is an `or`, so the
    // both-true state is the one that can never be reached by a test that
    // sets them one at a time — `isParentOfAnyone` alone already
    // short-circuits it. A santri old enough for their own login whose
    // younger sibling is enrolled under their name is the shape; it is
    // rare, and it is the cell an exhaustive sweep exists to cover.
    const own = link({ parent_id: OTHER_PARENT, user_id: STUDENT16 })
    const sibling = link({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', parent_id: STUDENT16 })
    expect(familyRelationships(STUDENT16, [own, sibling])).toEqual({
      isParentOfAnyone: true,
      isSelfStudent: true,
    })
    expect(yes(STUDENT16, [own, sibling])).toBe(true)
  })

  it('answers the same for the same relationships however many rows carry them', () => {
    // The overlap case (pgTAP RLS-36) reaches one student row by two
    // grants, and a parent of three children reaches three rows by one.
    // Neither is a different answer: the predicate is over relationships,
    // and `some` is not a count.
    const three = [
      link({ parent_id: TUTOR_PARENT }),
      link({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', parent_id: TUTOR_PARENT }),
      link({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', parent_id: TUTOR_PARENT }),
    ]
    expect(familyRelationships(TUTOR_PARENT, three)).toEqual({
      isParentOfAnyone: true,
      isSelfStudent: false,
    })
  })
})

/**
 * All four states of the predicate, swept.
 *
 * `canReceiveNotifications` is the single gate in front of push
 * subscription storage, the settings toggle, the bell, the centre and
 * the audience builder, so the cost of a wrong cell is either a family
 * hearing nothing (the ADR-022 bug) or an account being offered a screen
 * it has no rows for. Four cells is small enough to state exhaustively,
 * which is the only way to say "and nothing else" about a boolean rule.
 */
describe('every state of the recipient predicate', () => {
  const cells: Array<[boolean, boolean, boolean]> = [
    // parent, self, expected
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ]

  it.each(cells)(
    'isParentOfAnyone=%s isSelfStudent=%s → %s',
    (isParentOfAnyone, isSelfStudent, expected) => {
      expect(canReceiveNotifications({ isParentOfAnyone, isSelfStudent })).toBe(expected)
    },
  )

  it('consults nothing but those two fields', () => {
    // The predicate is deliberately dependency-free so the browser bundle
    // and `netlify/functions/` can share one copy. This asserts the other
    // half of that: extra fields on the value — a `Capabilities` carries
    // two more — cannot change the answer, so the settings screen and
    // `push-subscribe` cannot reach different conclusions about one
    // account.
    const relationships = { isParentOfAnyone: false, isSelfStudent: false }
    const withTutorAndAdmin = { ...relationships, isTutorOfAnyClass: true, isAdmin: true }
    expect(canReceiveNotifications(withTutorAndAdmin)).toBe(false)
    expect(canReceiveNotifications({ ...withTutorAndAdmin, isParentOfAnyone: true })).toBe(true)
  })
})

describe('fetchFamilyRelationships — the query push-subscribe asks', () => {
  function fakeClient(rows: Pick<FamilyLink, 'parent_id' | 'user_id'>[], error: unknown = null) {
    const calls: { table?: string; select?: string; or?: string } = {}
    const builder = {
      select(columns: string) {
        calls.select = columns
        return this
      },
      or(filter: string) {
        calls.or = filter
        return Promise.resolve({ data: rows, error })
      },
    }
    const client = {
      from(table: string) {
        calls.table = table
        return builder
      },
    } as unknown as Parameters<typeof fetchFamilyRelationships>[0]
    return { client, calls }
  }

  it('asks students for both link columns and nothing else', () => {
    // Data minimisation on what a Function loads, not only on what it
    // sends: deciding whether to store a push endpoint does not require
    // reading a list of children's names.
    const { client, calls } = fakeClient([])
    return fetchFamilyRelationships(client, TUTOR_PARENT).then(() => {
      expect(calls.table).toBe('students')
      expect(calls.select).toBe('parent_id, user_id')
      expect(calls.or).toBe(`parent_id.eq.${TUTOR_PARENT},user_id.eq.${TUTOR_PARENT}`)
    })
  })

  it('derives the same two booleans the screens derive', () => {
    const { client } = fakeClient([{ parent_id: TUTOR_PARENT, user_id: null }])
    return fetchFamilyRelationships(client, TUTOR_PARENT).then((who) => {
      expect(who).toEqual({ isParentOfAnyone: true, isSelfStudent: false })
      expect(canReceiveNotifications(who)).toBe(true)
    })
  })

  it('throws rather than reporting "not a recipient" when the query fails', () => {
    // The whole failure mode this ADR is about is silent non-delivery.
    // A swallowed error here would 403 a real parent's subscribe and
    // look exactly like the rule working.
    const { client } = fakeClient([], { message: 'connection reset' })
    return expect(fetchFamilyRelationships(client, TUTOR_PARENT)).rejects.toEqual({
      message: 'connection reset',
    })
  })
})
