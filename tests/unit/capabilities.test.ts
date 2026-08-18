import { describe, expect, it } from 'vitest'
import {
  NO_CAPABILITIES,
  deriveCapabilities,
  familyLinkFilter,
  fetchViewerRelationships,
  isSelfRecord,
  selfStudentId,
  fetchFamilyLinks,
  fetchTaughtClasses,
  fetchTutorClassCount,
  type FamilyLink,
  type TaughtClass,
} from '../../src/lib/capabilities'

// Fixed ids, readable at a glance in the assertions below.
const TP = '11111111-1111-4111-8111-111111111111' // tutor of one class, parent of a child in another
const PARENT = '22222222-2222-4222-8222-222222222222'
const STUDENT16 = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'
const SUBJECT = '55555555-5555-4555-8555-555555555555' // the account under test in the lattice sweep

function link(over: Partial<FamilyLink> = {}): FamilyLink {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    full_name: 'Anak',
    parent_id: PARENT,
    user_id: null,
    ...over,
  }
}

describe('familyLinkFilter — the filter that stops a tutor-parent seeing a class as their children', () => {
  it('asks for both family links, not just parentage', () => {
    // `user_id.eq` is the 16+ self-login student's only link to their
    // own record. Dropping it silently empties every screen for them —
    // they have no `parent_id` row of their own.
    expect(familyLinkFilter(TP)).toBe(`parent_id.eq.${TP},user_id.eq.${TP}`)
  })

  it('refuses anything that is not a UUID', () => {
    // PostgREST's `or=` takes a filter expression as a string, so a
    // value with a comma in it would add a disjunct rather than be
    // compared against. The id always comes from the session today;
    // this is what keeps that true for the next caller.
    expect(() => familyLinkFilter('')).toThrow(/expected a UUID/)
    expect(() => familyLinkFilter(`${TP},role.eq.admin`)).toThrow(/expected a UUID/)
    expect(() => familyLinkFilter('not-a-uuid')).toThrow(/expected a UUID/)
  })
})

describe('deriveCapabilities — relationships in, capabilities out (ADR-019)', () => {
  const base = { familyLinks: [] as FamilyLink[], tutorClassCount: 0 }

  it('gives a parent of two children exactly the parent capability', () => {
    expect(
      deriveCapabilities({
        ...base,
        userId: PARENT,
        role: 'parent',
        familyLinks: [link(), link({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })],
      }),
    ).toEqual({ ...NO_CAPABILITIES, isParentOfAnyone: true })
  })

  it('gives a tutor of one class exactly the tutor capability', () => {
    expect(
      deriveCapabilities({ ...base, userId: TP, role: 'tutor', tutorClassCount: 1 }),
    ).toEqual({ ...NO_CAPABILITIES, isTutorOfAnyClass: true })
  })

  it('gives a 16+ self-login student the self capability and not the parent one', () => {
    // Their row's `parent_id` is their actual parent's id, never their
    // own — reading "I appear in a students row" as parenthood would
    // hand every 16+ student a ChildPicker over themselves.
    expect(
      deriveCapabilities({
        ...base,
        userId: STUDENT16,
        role: 'student',
        familyLinks: [link({ parent_id: OTHER, user_id: STUDENT16 })],
      }),
    ).toEqual({ ...NO_CAPABILITIES, isSelfStudent: true })
  })

  it('gives a tutor-parent the union of both, from one query each', () => {
    // The case this whole change exists for. Note `role: 'parent'` —
    // the tutor capability comes from the class relationship, exactly
    // as the RLS policies do it (RLS-28…RLS-29).
    expect(
      deriveCapabilities({
        ...base,
        userId: TP,
        role: 'parent',
        familyLinks: [link({ parent_id: TP })],
        tutorClassCount: 1,
      }),
    ).toEqual({ ...NO_CAPABILITIES, isParentOfAnyone: true, isTutorOfAnyClass: true })
  })

  it('gives a student assistant both the self and tutor capabilities', () => {
    // A 16+ student who also helps teach a class (ADR-020). `role` says
    // student and the tutor capability comes from the class
    // relationship, exactly as RLS-35 has it — and being a student
    // never implied read-only in the first place, since no policy in the
    // schema consults the role column except `fn_is_admin()`.
    expect(
      deriveCapabilities({
        ...base,
        userId: STUDENT16,
        role: 'student',
        familyLinks: [link({ parent_id: OTHER, user_id: STUDENT16 })],
        tutorClassCount: 1,
      }),
    ).toEqual({ ...NO_CAPABILITIES, isSelfStudent: true, isTutorOfAnyClass: true })
  })

  it('does not call a tutor with no class assigned a tutor', () => {
    // A newly invited tutor before an admin puts them in a class. The
    // role column says tutor; the relationship does not exist yet, and
    // RLS gives them nothing until it does.
    const caps = deriveCapabilities({ ...base, userId: TP, role: 'tutor', tutorClassCount: 0 })
    expect(caps.isTutorOfAnyClass).toBe(false)
  })

  it('keeps isAdmin a role check, because fn_is_admin() is one', () => {
    // ADR-014's super admin is a granted position, not a relationship.
    // An admin with no children and no class is still an admin…
    expect(deriveCapabilities({ ...base, userId: OTHER, role: 'admin' })).toEqual({
      ...NO_CAPABILITIES,
      isAdmin: true,
    })
    // …and an admin whose own child attends is both, without either
    // capability standing in for the other.
    expect(
      deriveCapabilities({
        ...base,
        userId: OTHER,
        role: 'admin',
        familyLinks: [link({ parent_id: OTHER })],
      }),
    ).toEqual({ ...NO_CAPABILITIES, isAdmin: true, isParentOfAnyone: true })
  })

  it('grants nothing at all when there is no profile yet', () => {
    expect(deriveCapabilities({ ...base, userId: OTHER, role: null })).toEqual(NO_CAPABILITIES)
  })
})

/**
 * The whole lattice, not a selection from it.
 *
 * The cases above are the combinations somebody thought to name. Four
 * independent booleans have sixteen, and the claim ADR-019 rests on is
 * that they are genuinely independent — that no capability implies
 * another, suppresses another, or is reachable by a route other than its
 * own relationship. A hand-picked list can only ever demonstrate the
 * cells it lists; this sweeps every one, so a future short-circuit
 * ("an admin obviously isn't a parent", "a student can't be a tutor")
 * fails here rather than in a family's screen.
 *
 * The four inputs are deliberately mismatched to the outputs where they
 * can be: `role` is only ever allowed to produce `isAdmin`, and for the
 * non-admin cells the role column is set to whatever would be *wrong* if
 * anything read it.
 */
describe('the sixteen combinations of the four capabilities', () => {
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

  it.each(combinations)(
    'admin=$isAdmin tutor=$isTutorOfAnyClass parent=$isParentOfAnyone self=$isSelfStudent',
    (expected) => {
      const familyLinks: FamilyLink[] = []
      // Two separate rows, because they are two separate relationships:
      // a child of theirs, and their own 16+ record whose `parent_id` is
      // somebody else entirely.
      if (expected.isParentOfAnyone) familyLinks.push(link({ parent_id: SUBJECT }))
      if (expected.isSelfStudent) {
        familyLinks.push(
          link({
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            parent_id: OTHER,
            user_id: SUBJECT,
          }),
        )
      }
      expect(
        deriveCapabilities({
          userId: SUBJECT,
          // The one input that may set `isAdmin`, and the one that may
          // never set anything else: for every non-admin cell the role
          // column says something the capabilities must not echo.
          role: expected.isAdmin ? 'admin' : 'student',
          familyLinks,
          tutorClassCount: expected.isTutorOfAnyClass ? 2 : 0,
        }),
      ).toEqual(expected)
    },
  )

  it('never reads one relationship out of the other one’s row', () => {
    // The two family booleans come from two different columns of
    // possibly the same row, and the failure mode is subtle: a 16+
    // santri whose own record is read as parenthood becomes a "parent"
    // with a ChildPicker over themselves, and a parent whose child has a
    // self-login becomes a "student" and is offered a santri's screens.
    const ownRecord = link({ parent_id: OTHER, user_id: SUBJECT })
    const theirChildWithOwnLogin = link({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      parent_id: SUBJECT,
      user_id: OTHER,
    })
    expect(
      deriveCapabilities({
        userId: SUBJECT,
        role: 'parent',
        familyLinks: [ownRecord, theirChildWithOwnLogin],
        tutorClassCount: 0,
      }),
    ).toEqual({ ...NO_CAPABILITIES, isParentOfAnyone: true, isSelfStudent: true })
  })

  it('counts a person once however many rows reach them', () => {
    // The overlap case at the data layer (pgTAP RLS-36): a tutor whose
    // own child sits in the class they teach. Both grants reach the same
    // student row, and the capability is still one boolean — the screens
    // derive from these, so a "true twice" would have to become a count
    // somewhere before it could become a duplicate.
    expect(
      deriveCapabilities({
        userId: SUBJECT,
        role: 'parent',
        familyLinks: [link({ parent_id: SUBJECT }), link({ parent_id: SUBJECT })],
        tutorClassCount: 1,
      }),
    ).toEqual({ ...NO_CAPABILITIES, isParentOfAnyone: true, isTutorOfAnyClass: true })
  })
})

describe('selfStudentId — which roster row is the viewer’s own', () => {
  it('finds the caller’s own record by user_id, not by parentage', () => {
    // Aisyah's row: `parent_id` is her actual parent, `user_id` is her.
    // Reading `parent_id` here would return null for her and — worse —
    // a *child's* id for every parent, which is the id the register
    // would then refuse to submit.
    const own = link({ id: 'own-record', parent_id: OTHER, user_id: STUDENT16 })
    expect(selfStudentId(STUDENT16, [link({ parent_id: STUDENT16 }), own])).toBe('own-record')
  })

  it('is null for a parent, however many children they have', () => {
    // Which is the answer that makes `recordableStudents` a no-op for
    // every account in the TPA but one.
    expect(selfStudentId(PARENT, [link({ parent_id: PARENT }), link({ parent_id: PARENT })])).toBe(
      null,
    )
  })

  it('is null for a tutor-parent, so their own child stays recordable (ADR-024)', () => {
    // Bapak Hasan holds no `students` record of his own. If this ever
    // returned his daughter's id, the register that teaches his class
    // would silently stop submitting her row.
    expect(selfStudentId(TP, [link({ id: 'khadijah', parent_id: TP })])).toBe(null)
  })

  it('is null when the person has no family link at all', () => {
    expect(selfStudentId(OTHER, [])).toBe(null)
  })
})

describe('isSelfRecord — the question the family screens used to ask of the role column', () => {
  it('is true only for the viewer’s own record', () => {
    expect(isSelfRecord('own-record', 'own-record')).toBe(true)
    expect(isSelfRecord('somebody-else', 'own-record')).toBe(false)
  })

  it('is false for everyone who has no record of their own', () => {
    // A parent, a tutor, an admin. This is what keeps the confirm
    // control on FamilyMurajaahView exactly where it was for them —
    // and puts it back for the ustadzah whose role column says `tutor`
    // while `fn_my_children()` holds her son (RLS-19).
    expect(isSelfRecord('any-child', null)).toBe(false)
  })

  it('is false before a child has been picked', () => {
    // The family screens render before the ChildPicker has a value, and
    // a null studentId is "nothing selected", never "this is me".
    expect(isSelfRecord(null, 'own-record')).toBe(false)
    expect(isSelfRecord(null, null)).toBe(false)
  })
})

describe('fetchFamilyLinks — the query itself, not just its result', () => {
  function fakeClient(rows: FamilyLink[]) {
    const calls: { table?: string; select?: string; or?: string; order?: string } = {}
    const builder = {
      select(columns: string) {
        calls.select = columns
        return this
      },
      or(filter: string) {
        calls.or = filter
        return this
      },
      order(column: string) {
        calls.order = column
        return Promise.resolve({ data: rows, error: null })
      },
    }
    const client = {
      from(table: string) {
        calls.table = table
        return builder
      },
    } as unknown as Parameters<typeof fetchFamilyLinks>[0]
    return { client, calls }
  }

  it('filters on the relationship instead of trusting RLS to narrow it', () => {
    // The regression this guards: an unfiltered `select` returns the
    // union of all four permissive `students` policies, so a
    // tutor-parent's ChildPicker would list their whole class and an
    // admin's would list the school.
    const { client, calls } = fakeClient([])
    return fetchFamilyLinks(client, TP).then(() => {
      expect(calls.table).toBe('students')
      expect(calls.or).toBe(`parent_id.eq.${TP},user_id.eq.${TP}`)
      expect(calls.order).toBe('full_name')
    })
  })

  it('selects the two link columns the capability derivation needs', () => {
    const { client, calls } = fakeClient([])
    return fetchFamilyLinks(client, TP).then(() => {
      expect(calls.select).toContain('parent_id')
      expect(calls.select).toContain('user_id')
    })
  })

  it('returns the rows as given, in the order the query asked for', () => {
    const rows = [link({ parent_id: TP }), link({ parent_id: OTHER, user_id: TP })]
    const { client } = fakeClient(rows)
    return fetchFamilyLinks(client, TP).then((data) => expect(data).toEqual(rows))
  })

  it('throws the Postgrest error rather than reporting an empty family', () => {
    // A swallowed error here reads as "you have no children", which is
    // indistinguishable on screen from a real empty state.
    const client = {
      from: () => ({
        select: () => ({
          or: () => ({
            order: () => Promise.resolve({ data: null, error: { message: 'permission denied' } }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof fetchFamilyLinks>[0]
    return expect(fetchFamilyLinks(client, TP)).rejects.toMatchObject({
      message: 'permission denied',
    })
  })
})

describe('fetchTutorClassCount', () => {
  function fakeClient(count: number) {
    const calls: {
      table?: string
      options?: { count?: string; head?: boolean }
      containsColumn?: string
      containsValue?: unknown
    } = {}
    const client = {
      from(table: string) {
        calls.table = table
        return {
          select(_columns: string, options: { count?: string; head?: boolean }) {
            calls.options = options
            return {
              contains(column: string, value: unknown) {
                calls.containsColumn = column
                calls.containsValue = value
                return Promise.resolve({ count, error: null })
              },
            }
          },
        }
      },
    } as unknown as Parameters<typeof fetchTutorClassCount>[0]
    return { client, calls }
  }

  it('asks whether the caller is in tutor_ids, not how many classes RLS returns', () => {
    // `classes_read` also returns the classes a caller's *children* are
    // in, and every class in the school to an admin — counting its rows
    // would make every parent a tutor.
    const { client, calls } = fakeClient(2)
    return fetchTutorClassCount(client, TP).then((n) => {
      expect(calls.table).toBe('classes')
      expect(calls.containsColumn).toBe('tutor_ids')
      expect(calls.containsValue).toEqual([TP])
      expect(n).toBe(2)
    })
  })

  it('counts without fetching the rows', () => {
    const { client, calls } = fakeClient(0)
    return fetchTutorClassCount(client, TP).then(() => {
      expect(calls.options).toEqual({ count: 'exact', head: true })
    })
  })

  it('treats a null count as no classes', () => {
    const client = {
      from: () => ({
        select: () => ({ contains: () => Promise.resolve({ count: null, error: null }) }),
      }),
    } as unknown as Parameters<typeof fetchTutorClassCount>[0]
    return expect(fetchTutorClassCount(client, TP)).resolves.toBe(0)
  })
})

describe('fetchTaughtClasses — the tutor-side mirror of the same fix', () => {
  const GRUP_A: TaughtClass = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: 'Grup A',
    schedule: 'Sabtu 10:00-12:00',
  }

  function fakeClient(rows: TaughtClass[]) {
    const calls: {
      table?: string
      select?: string
      containsColumn?: string
      containsValue?: unknown
      order?: string
    } = {}
    const builder = {
      contains(column: string, value: unknown) {
        calls.containsColumn = column
        calls.containsValue = value
        return this
      },
      order(column: string) {
        calls.order = column
        return Promise.resolve({ data: rows, error: null })
      },
    }
    const client = {
      from(table: string) {
        calls.table = table
        return {
          select(columns: string) {
            calls.select = columns
            return builder
          },
        }
      },
    } as unknown as Parameters<typeof fetchTaughtClasses>[0]
    return { client, calls }
  }

  it('asks for the classes the caller is named in, not the ones they may read', () => {
    // `classes_read` also grants the classes a caller's children are in,
    // so an unfiltered select offered a tutor-parent a class they cannot
    // record against — the roster comes back holding their own child
    // alone and the save fails on `fn_my_classes()`.
    const { client, calls } = fakeClient([GRUP_A])
    return fetchTaughtClasses(client, TP, { isAdmin: false }).then((rows) => {
      expect(calls.table).toBe('classes')
      expect(calls.containsColumn).toBe('tutor_ids')
      expect(calls.containsValue).toEqual([TP])
      expect(calls.order).toBe('name')
      expect(rows).toEqual([GRUP_A])
    })
  })

  it('gives an admin every class, since an admin is in no tutor_ids array', () => {
    // ADR-014: admin takes the tutor shape over the whole TPA. Filtering
    // on `tutor_ids` would hand them an empty picker on every recording
    // screen.
    const { client, calls } = fakeClient([GRUP_A])
    return fetchTaughtClasses(client, OTHER, { isAdmin: true }).then((rows) => {
      expect(calls.containsColumn).toBeUndefined()
      expect(calls.order).toBe('name')
      expect(rows).toEqual([GRUP_A])
    })
  })

  it('throws rather than presenting an empty picker', () => {
    const client = {
      from: () => ({
        select: () => ({
          contains: () => ({
            order: () => Promise.resolve({ data: null, error: { message: 'permission denied' } }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof fetchTaughtClasses>[0]
    return expect(fetchTaughtClasses(client, TP, { isAdmin: false })).rejects.toMatchObject({
      message: 'permission denied',
    })
  })
})

/**
 * The wrapper the app actually calls, which nothing exercised until now:
 * every test above reaches past it to one of the two queries or to the
 * pure derivation. What it adds on top of them is a decision — that the
 * two relationship queries are independent and therefore run together —
 * and a failure mode, since a rejection from either one has to surface
 * rather than resolve into a smaller capability set.
 */
describe('fetchViewerRelationships — the two relationship queries, together', () => {
  function fakeClient(over: {
    links?: FamilyLink[]
    classCount?: number
    linksError?: unknown
    classesError?: unknown
  }) {
    const started: string[] = []
    let resolveLinks: (() => void) | undefined
    const client = {
      from(table: string) {
        started.push(table)
        if (table === 'students') {
          return {
            select: () => ({
              or: () => ({
                order: () =>
                  // Deliberately deferred: if the two queries were
                  // awaited in sequence, `classes` would not have been
                  // touched by the time this is still pending.
                  new Promise((resolve) => {
                    resolveLinks = () =>
                      resolve({ data: over.links ?? [], error: over.linksError ?? null })
                  }),
              }),
            }),
          }
        }
        return {
          select: () => ({
            contains: () =>
              Promise.resolve({ count: over.classCount ?? 0, error: over.classesError ?? null }),
          }),
        }
      },
    } as unknown as Parameters<typeof fetchViewerRelationships>[0]
    return { client, started, releaseLinks: () => resolveLinks?.() }
  }

  it('asks both questions at once, not one after the other', async () => {
    // Two independent round trips on the critical path of every page
    // load. Awaiting them in sequence doubles the latency of the first
    // screen a family sees, on the connection they are most likely to
    // have.
    const { client, started, releaseLinks } = fakeClient({ classCount: 1 })
    const pending = fetchViewerRelationships(client, TP, 'parent')
    await Promise.resolve()
    expect(started).toEqual(['students', 'classes'])
    releaseLinks()
    await pending
  })

  it('combines both answers into the capability set the screens hold', async () => {
    const { client, releaseLinks } = fakeClient({
      links: [link({ parent_id: TP })],
      classCount: 1,
    })
    const pending = fetchViewerRelationships(client, TP, 'parent')
    releaseLinks()
    await expect(pending).resolves.toEqual({
      capabilities: { ...NO_CAPABILITIES, isParentOfAnyone: true, isTutorOfAnyClass: true },
      // Their child's row, not their own: `selfStudentId` reads
      // `user_id`, and a parent is never in that column.
      selfStudentId: null,
    })
  })

  it('passes the role straight through without letting it imply anything else', async () => {
    // An admin with no children and no class: `isAdmin` is the only
    // capability the role column may produce, here as in
    // `deriveCapabilities`.
    const { client, releaseLinks } = fakeClient({})
    const pending = fetchViewerRelationships(client, OTHER, 'admin')
    releaseLinks()
    await expect(pending).resolves.toEqual({
      capabilities: { ...NO_CAPABILITIES, isAdmin: true },
      selfStudentId: null,
    })
  })

  it('rejects when either query fails, rather than reporting fewer capabilities', async () => {
    // A swallowed error here is indistinguishable from "this person is
    // nobody" — which is a family locked out of their own child's
    // screens with no error to explain it.
    const links = fakeClient({ linksError: { message: 'students unavailable' } })
    const linksPending = fetchViewerRelationships(links.client, TP, 'parent')
    links.releaseLinks()
    await expect(linksPending).rejects.toMatchObject({ message: 'students unavailable' })

    const classes = fakeClient({ classesError: { message: 'classes unavailable' } })
    const classesPending = fetchViewerRelationships(classes.client, TP, 'parent')
    classes.releaseLinks()
    await expect(classesPending).rejects.toMatchObject({ message: 'classes unavailable' })
  })
})
