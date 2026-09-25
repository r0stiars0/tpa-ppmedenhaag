import { describe, expect, it } from 'vitest'
import { computeAttendanceRate, ratesByGroup } from '../../src/lib/attendance'

describe('computeAttendanceRate', () => {
  it('returns 0 for no records', () => {
    expect(computeAttendanceRate([])).toBe(0)
  })

  it('counts present and late as attended, absent as not', () => {
    expect(computeAttendanceRate(['present', 'present', 'absent', 'late'])).toBe(75)
  })

  it('returns 100 when nobody was absent', () => {
    expect(computeAttendanceRate(['present', 'late', 'present'])).toBe(100)
  })

  it('returns 0 when every record is absent', () => {
    expect(computeAttendanceRate(['absent', 'absent'])).toBe(0)
  })

  it('rounds to 1 decimal place', () => {
    expect(computeAttendanceRate(['present', 'absent', 'absent'])).toBe(33.3)
  })
})

describe('ratesByGroup — one rate per group, plus the overall (PRD Feature 8 FR-003)', () => {
  const row = (classId: string, className: string, status: 'present' | 'absent' | 'late') => ({
    classId,
    className,
    status,
  })

  it('gives each group its own rate, so skipping one group is not hidden by the other', () => {
    const rows = [
      ...Array.from({ length: 9 }, () => row('kelas-a', 'Kelas A', 'present')),
      row('kelas-a', 'Kelas A', 'absent'),
      ...Array.from({ length: 5 }, () => row('aqidah', 'Aqidah', 'present')),
      ...Array.from({ length: 5 }, () => row('aqidah', 'Aqidah', 'absent')),
    ]
    expect(ratesByGroup(rows)).toEqual({
      overall: 70,
      groups: [
        { classId: 'aqidah', className: 'Aqidah', rate: 50, sessions: 10 },
        { classId: 'kelas-a', className: 'Kelas A', rate: 90, sessions: 10 },
      ],
    })
  })

  it('counts late as attended, as the overall rate does', () => {
    expect(ratesByGroup([row('a', 'A', 'late'), row('a', 'A', 'absent')]).groups[0].rate).toBe(50)
  })

  it('returns no groups and 0 overall for no records', () => {
    expect(ratesByGroup([])).toEqual({ overall: 0, groups: [] })
  })
})
