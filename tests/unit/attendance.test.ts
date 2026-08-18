import { describe, expect, it } from 'vitest'
import { computeAttendanceRate } from '../../src/lib/attendance'

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
