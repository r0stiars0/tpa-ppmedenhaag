import { describe, expect, it } from 'vitest'
import {
  groupSessionSeries,
  lastMarks,
  overviewTutors,
  sparklinePoints,
  tutorOverview,
  worstStatus,
} from '../../src/lib/attendanceStats'

/**
 * The pure halves of the attendance graphs (TAD ADR-046): the group tile
 * (a), the family dot strip (b) and the admin tutor overview (e). The
 * screens only draw what these return.
 */

describe('groupSessionSeries — the "Kehadiran santri" tile', () => {
  it('skips sessions with nothing recorded, keeps the last 8 oldest-first, late counts as attended', () => {
    const sessions = [
      // newest first, the order the query returns
      { date: '2026-09-27', statuses: [] }, // opened today, nothing recorded yet
      { date: '2026-09-20', statuses: ['present', 'late', 'absent', 'present'] as const },
      ...Array.from({ length: 9 }, (_, i) => ({
        date: `2026-07-${String(20 - i).padStart(2, '0')}`,
        statuses: ['present', 'present'] as const,
      })),
    ].map((s) => ({ ...s, statuses: [...s.statuses] }))

    const { points, latest, average } = groupSessionSeries(sessions)
    expect(points).toHaveLength(8)
    expect(points[0].date < points[7].date).toBe(true)
    expect(latest).toEqual({ date: '2026-09-20', attended: 3, total: 4, rate: 75 })
    // pooled over the 8 points: 7 sessions of 2/2 plus 3/4 → 17/18
    expect(average).toBe(94)
  })

  it('returns nothing to draw when no session has been recorded', () => {
    expect(groupSessionSeries([{ date: '2026-09-27', statuses: [] }])).toEqual({
      points: [],
      latest: null,
      average: null,
    })
  })
})

describe('sparklinePoints', () => {
  it('spreads points across the width and maps 100% to the top', () => {
    expect(sparklinePoints([100, 50, 0], 120, 44, 4)).toEqual([
      [4, 4],
      [60, 22],
      [116, 40],
    ])
  })

  it('centres a single point', () => {
    expect(sparklinePoints([100], 120, 44, 4)).toEqual([[60, 4]])
  })
})

describe('lastMarks — the family dot strip', () => {
  it('returns the latest n rows oldest-first, whatever order they came in', () => {
    const rows = ['2026-09-20', '2026-09-06', '2026-09-13', '2026-08-30'].map((date) => ({
      date,
      status: 'present' as const,
    }))
    expect(lastMarks(rows, 3).map((r) => r.date)).toEqual(['2026-09-06', '2026-09-13', '2026-09-20'])
  })
})

describe('worstStatus', () => {
  it('absent beats late beats present', () => {
    expect(worstStatus(['present', 'late'])).toBe('late')
    expect(worstStatus(['late', 'absent', 'present'])).toBe('absent')
    expect(worstStatus(['present'])).toBe('present')
  })
})

describe('tutorOverview — Hadir › Guru', () => {
  const sessions = [
    { id: 's1', classId: 'A', date: '2026-09-06', held: true },
    { id: 's2', classId: 'A', date: '2026-09-13', held: true },
    { id: 's3', classId: 'B', date: '2026-09-14', held: true },
    { id: 's4', classId: 'A', date: '2026-09-20', held: true },
    { id: 's5', classId: 'B', date: '2026-09-21', held: true },
    // opened by the register today, nothing recorded — not a column
    { id: 's6', classId: 'A', date: '2026-09-27', held: false },
  ]
  const tutors = [
    { id: 'ahmad', name: 'Ustadz Ahmad', classIds: ['A'] },
    { id: 'aminah', name: 'Ustadzah Aminah', classIds: ['A', 'B'] },
    { id: 'baru', name: 'Ustadz Baru', classIds: [] }, // moved away; only old rows
  ]
  const rows = [
    { sessionId: 's1', tutorId: 'ahmad', status: 'present' as const, reason: null },
    { sessionId: 's2', tutorId: 'ahmad', status: 'late' as const, reason: null },
    { sessionId: 's4', tutorId: 'ahmad', status: 'absent' as const, reason: 'Sakit' },
    { sessionId: 's1', tutorId: 'aminah', status: 'present' as const, reason: null },
    { sessionId: 's3', tutorId: 'aminah', status: 'present' as const, reason: null },
    { sessionId: 's2', tutorId: 'baru', status: 'present' as const, reason: null },
  ]

  it('uses the held dates as shared columns, oldest-first', () => {
    const { columns } = tutorOverview({ tutors, sessions, rows })
    expect(columns).toEqual(['2026-09-06', '2026-09-13', '2026-09-14', '2026-09-20', '2026-09-21'])
  })

  it('marks recorded, not recorded and no session per tutor', () => {
    const byId = Object.fromEntries(tutorOverview({ tutors, sessions, rows }).tutors.map((t) => [t.id, t]))
    expect(byId.ahmad.marks).toEqual(['present', 'late', 'noSession', 'absent', 'noSession'])
    expect(byId.aminah.marks).toEqual(['present', 'notRecorded', 'present', 'notRecorded', 'notRecorded'])
    // no current group: only the recorded row shows, never "not recorded"
    expect(byId.baru.marks).toEqual(['noSession', 'present', 'noSession', 'noSession', 'noSession'])
  })

  it('rates recorded rows only, late as attended; not recorded counts neither way', () => {
    const byId = Object.fromEntries(tutorOverview({ tutors, sessions, rows }).tutors.map((t) => [t.id, t]))
    expect(byId.ahmad.rate).toBe(66.7)
    expect(byId.ahmad.counts).toEqual({ present: 1, late: 1, absent: 1 })
    expect(byId.aminah.rate).toBe(100)
  })

  it('keeps only the last n columns and sorts tutors by name', () => {
    const { columns, tutors: out } = tutorOverview({ tutors, sessions, rows, n: 2 })
    expect(columns).toEqual(['2026-09-20', '2026-09-21'])
    expect(out.map((t) => t.name)).toEqual(['Ustadz Ahmad', 'Ustadz Baru', 'Ustadzah Aminah'])
    expect(out.every((t) => t.marks.length === 2)).toBe(true)
  })

  it('takes the worst status when a tutor was marked in two groups the same day', () => {
    const { tutors: out } = tutorOverview({
      tutors: [{ id: 'x', name: 'X', classIds: ['A', 'B'] }],
      sessions: [
        { id: 'a', classId: 'A', date: '2026-09-20', held: true },
        { id: 'b', classId: 'B', date: '2026-09-20', held: true },
      ],
      rows: [
        { sessionId: 'a', tutorId: 'x', status: 'present', reason: null },
        { sessionId: 'b', tutorId: 'x', status: 'late', reason: null },
      ],
    })
    expect(out[0].marks).toEqual(['late'])
  })

  it('leaves out a tutor with no group in the filter and no rows, and gives no rate without rows', () => {
    const { tutors: out } = tutorOverview({
      tutors: [
        { id: 'gone', name: 'Gone', classIds: [] },
        { id: 'new', name: 'New', classIds: ['A'] },
      ],
      sessions: [{ id: 's', classId: 'A', date: '2026-09-20', held: true }],
      rows: [],
    })
    expect(out.map((t) => t.id)).toEqual(['new'])
    expect(out[0].rate).toBeNull()
    expect(out[0].marks).toEqual(['notRecorded'])
  })
})

describe('overviewTutors — who gets a row in Hadir › Guru', () => {
  it('lists the tutors of the filtered groups with their groups, plus anyone with rows', () => {
    const tutors = overviewTutors({
      classIds: ['A', 'B'],
      tutorsByClass: {
        A: [{ user_id: 'u1', full_name: 'Ahmad' }],
        B: [
          { user_id: 'u1', full_name: 'Ahmad' },
          { user_id: 'u2', full_name: 'Aminah' },
        ],
        C: [{ user_id: 'u3', full_name: 'Only in C' }],
      },
      names: { u1: 'Ahmad', u9: 'Moved away' },
    })
    expect(tutors).toEqual([
      { id: 'u1', name: 'Ahmad', classIds: ['A', 'B'] },
      { id: 'u2', name: 'Aminah', classIds: ['B'] },
      { id: 'u9', name: 'Moved away', classIds: [] },
    ])
  })
})
