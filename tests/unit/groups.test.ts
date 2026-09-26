import { describe, expect, it } from 'vitest'
import {
  groupsOf,
  murajaahImpact,
  studentsInActiveTrackingGroups,
  type MembershipRow,
} from '../../src/lib/groups'

/**
 * Multi-group enrolment (PRD Feature 8, TAD ADR-045): the pure rules the
 * Functions and screens share about a student's groups.
 */
const row = (
  student_id: string,
  class_id: string,
  tracks_progress: boolean,
  archived_at: string | null = null,
  name = class_id,
): MembershipRow => ({ student_id, class_id, class: { name, tracks_progress, archived_at } })

describe('studentsInActiveTrackingGroups — who a Murajaah target can still be managed for', () => {
  it('keeps a student in an active group with tracking on', () => {
    expect(studentsInActiveTrackingGroups([row('ali', 'yanbua', true)])).toEqual(new Set(['ali']))
  })

  it('drops a student whose only group has tracking off (an Aqidah-only child)', () => {
    expect(studentsInActiveTrackingGroups([row('ali', 'aqidah', false)])).toEqual(new Set())
  })

  it('drops a student whose only tracking group is archived', () => {
    expect(studentsInActiveTrackingGroups([row('ali', 'old', true, '2026-09-01T00:00:00Z')])).toEqual(new Set())
  })

  it('keeps a student with at least one qualifying group among several', () => {
    const rows = [row('ali', 'aqidah', false), row('ali', 'old', true, '2026-09-01T00:00:00Z'), row('ali', 'yanbua', true)]
    expect(studentsInActiveTrackingGroups(rows)).toEqual(new Set(['ali']))
  })

  it('tolerates a row whose group could not be joined', () => {
    expect(studentsInActiveTrackingGroups([{ student_id: 'ali', class_id: 'x', class: null }])).toEqual(new Set())
  })
})

describe("groupsOf — a student's groups, for labels and pickers", () => {
  const rows = [
    row('ali', 'b', true, null, 'Yanbua B'),
    row('ali', 'a', false, null, 'Aqidah A'),
    row('ali', 'old', true, '2026-09-01T00:00:00Z', 'Old'),
    row('zainab', 'b', true, null, 'Yanbua B'),
  ]

  it("lists one student's active groups by name", () => {
    expect(groupsOf(rows, 'ali').map((g) => g.name)).toEqual(['Aqidah A', 'Yanbua B'])
  })

  it('includes archived groups only when asked', () => {
    expect(groupsOf(rows, 'ali', { includeArchived: true }).map((g) => g.name)).toEqual(['Aqidah A', 'Old', 'Yanbua B'])
  })

  it('returns nothing for a student in no group', () => {
    expect(groupsOf(rows, 'nobody')).toEqual([])
  })
})

describe('murajaahImpact — the close-or-keep prompt (PRD Feature 8 FR-001)', () => {
  const memberships = [
    row('ali', 'yb1', true),
    row('ali', 'aq', false),
    row('zainab', 'yb1', true),
    row('zainab', 'yb2', true),
    row('umar', 'aq', false),
  ]
  const targets = [
    { id: 't-ali', student_id: 'ali' },
    { id: 't-zainab', student_id: 'zainab' },
    { id: 't-umar', student_id: 'umar' },
  ]

  it('switching tracking off: a student left with no tracking group must close; one with another may keep', () => {
    const impact = murajaahImpact(targets, memberships, { kind: 'trackingOff', classId: 'yb1' })
    expect(impact).toEqual([
      { targetId: 't-ali', studentId: 'ali', mustClose: true },
      { targetId: 't-zainab', studentId: 'zainab', mustClose: false },
    ])
  })

  it('archiving a tracking group is the same decision (it also orphans targets)', () => {
    expect(murajaahImpact(targets, memberships, { kind: 'archive', classId: 'yb1' })).toEqual(
      murajaahImpact(targets, memberships, { kind: 'trackingOff', classId: 'yb1' }),
    )
  })

  it('removing members affects only those removed', () => {
    const impact = murajaahImpact(targets, memberships, { kind: 'removeMembers', classId: 'yb1', studentIds: ['ali'] })
    expect(impact).toEqual([{ targetId: 't-ali', studentId: 'ali', mustClose: true }])
  })

  it("saving a student's new group set compares before and after", () => {
    expect(
      murajaahImpact(targets, memberships, { kind: 'setGroups', studentId: 'zainab', trackingClassIds: ['yb2'] }),
    ).toEqual([{ targetId: 't-zainab', studentId: 'zainab', mustClose: false }])
    expect(
      murajaahImpact(targets, memberships, { kind: 'setGroups', studentId: 'zainab', trackingClassIds: [] }),
    ).toEqual([{ targetId: 't-zainab', studentId: 'zainab', mustClose: true }])
  })

  it('a swap to a different tracking group keeps the target manageable', () => {
    expect(
      murajaahImpact(targets, memberships, { kind: 'setGroups', studentId: 'ali', trackingClassIds: ['yb-new'] }),
    ).toEqual([{ targetId: 't-ali', studentId: 'ali', mustClose: false }])
  })

  it('touching a non-tracking group affects no target', () => {
    expect(murajaahImpact(targets, memberships, { kind: 'archive', classId: 'aq' })).toEqual([])
    expect(murajaahImpact(targets, memberships, { kind: 'removeMembers', classId: 'aq', studentIds: ['umar', 'ali'] })).toEqual([])
  })

  it("a change that keeps the student's tracking groups affects no target", () => {
    expect(murajaahImpact(targets, memberships, { kind: 'setGroups', studentId: 'ali', trackingClassIds: ['yb1'] })).toEqual([])
  })
})
