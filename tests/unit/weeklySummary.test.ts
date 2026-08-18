import { describe, expect, it } from 'vitest'
import {
  EMPTY_WEEK,
  attendancePercent,
  hasActivity,
  type WeeklyActivity,
} from '../../src/lib/weeklySummary'

function week(over: Partial<WeeklyActivity> = {}): WeeklyActivity {
  return { ...EMPTY_WEEK, ...over }
}

describe('hasActivity — the gate on the Friday digest', () => {
  it('is false for a week where nothing happened', () => {
    // School holidays are several weeks a year, and a notification
    // pointing at an empty summary is how a family learns to ignore
    // notifications (ADR-016).
    expect(hasActivity(week())).toBe(false)
  })

  it('is true on attendance alone, even if every session was an absence', () => {
    // A week of absences is very much worth a parent's attention.
    expect(hasActivity(week({ recorded: 2, absent: 2 }))).toBe(true)
  })

  it('is true on any one kind of progress', () => {
    expect(hasActivity(week({ yanbua: 1 }))).toBe(true)
    expect(hasActivity(week({ quran: 1 }))).toBe(true)
    expect(hasActivity(week({ murajaah: 1 }))).toBe(true)
  })
})

describe('attendancePercent', () => {
  it('is null, not 0, when the child was not marked in any session', () => {
    // The holiday case. Rendering this as 0% tells every family their
    // child attended nothing.
    expect(attendancePercent(week())).toBeNull()
  })

  it('is a whole-number percentage of the sessions actually recorded', () => {
    expect(attendancePercent(week({ recorded: 4, present: 4 }))).toBe(100)
    expect(attendancePercent(week({ recorded: 4, present: 3 }))).toBe(75)
    expect(attendancePercent(week({ recorded: 3, present: 1 }))).toBe(33)
    expect(attendancePercent(week({ recorded: 2, present: 0, absent: 2 }))).toBe(0)
  })

  it('counts late as not present, which is what the attendance screen means by it', () => {
    expect(attendancePercent(week({ recorded: 2, present: 1, late: 1 }))).toBe(50)
  })
})
