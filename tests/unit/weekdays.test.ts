import { describe, expect, it } from 'vitest'
import {
  currentScheduledSessionDate,
  DISPLAY_ORDER,
  dowOf,
  formatDayList,
  isMeetingDay,
  nextMeetingDay,
  normaliseDows,
  prevMeetingDay,
  todayDow,
} from '../../src/lib/weekdays'

// Reference dates (all in August 2025):
//   Sat 2025-08-02, Wed 2025-08-13, Sat 2025-08-16, Sun 2025-08-17,
//   Mon 2025-08-18, Sat 2025-08-23, Sat 2025-08-30

describe('dowOf', () => {
  it('maps calendar dates to dow with 0 = Sunday, 6 = Saturday', () => {
    expect(dowOf('2025-08-17')).toBe(0) // Sunday
    expect(dowOf('2025-08-18')).toBe(1) // Monday
    expect(dowOf('2025-08-13')).toBe(3) // Wednesday
    expect(dowOf('2025-08-16')).toBe(6) // Saturday
  })

  it('is timezone-stable across a DST spring-forward date', () => {
    // 2025-03-30 is the Europe/Amsterdam DST switch; the calendar date's
    // weekday must not depend on the host clock.
    expect(dowOf('2025-03-30')).toBe(0) // Sunday
    expect(dowOf('2025-03-31')).toBe(1) // Monday
  })
})

describe('todayDow', () => {
  it('returns the host-local weekday of the given Date', () => {
    expect(todayDow(new Date('2025-08-16T12:00:00'))).toBe(6)
    expect(todayDow(new Date('2025-08-17T12:00:00'))).toBe(0)
  })
})

describe('normaliseDows', () => {
  it('sorts ascending, de-duplicates and drops out-of-range values', () => {
    expect(normaliseDows([6, 3, 6])).toEqual([3, 6])
    expect(normaliseDows([0, 1, 2, 3, 4, 5, 6])).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(normaliseDows([-1, 7, 1.5, 2])).toEqual([2])
    expect(normaliseDows([])).toEqual([])
  })
})

describe('isMeetingDay', () => {
  it('is true only on a weekday present in the set', () => {
    expect(isMeetingDay([6], '2025-08-16')).toBe(true) // Saturday
    expect(isMeetingDay([6], '2025-08-13')).toBe(false) // Wednesday
    expect(isMeetingDay([3, 6], '2025-08-13')).toBe(true) // Wednesday
    expect(isMeetingDay([3, 6], '2025-08-17')).toBe(false) // Sunday
  })
})

describe('formatDayList', () => {
  const t = (key: string) => key.replace('weekday.', 'd').replace('.', '-') // e.g. "d6-short"

  it('renders Monday-first regardless of the input order', () => {
    expect(formatDayList([0, 6], t, 'short')).toBe('d6-short, d0-short') // Sat then Sun
    expect(formatDayList([6, 3], t, 'short')).toBe('d3-short, d6-short') // Wed then Sat
  })

  it('honours the style argument and defaults to short', () => {
    expect(formatDayList([1], t, 'long')).toBe('d1-long')
    expect(formatDayList([1], t)).toBe('d1-short')
  })

  it('is empty for an empty set', () => {
    expect(formatDayList([], t)).toBe('')
  })

  it('DISPLAY_ORDER is Monday-first and covers all seven days', () => {
    expect([...DISPLAY_ORDER]).toEqual([1, 2, 3, 4, 5, 6, 0])
  })
})

describe('prevMeetingDay', () => {
  it('returns the same date when it is already a meeting day', () => {
    expect(prevMeetingDay([6], '2025-08-16', '2025-08-01')).toBe('2025-08-16')
  })

  it('walks back within one week to the previous meeting day', () => {
    // From Monday 2025-08-18, a Saturday-only group last met 2025-08-16.
    expect(prevMeetingDay([6], '2025-08-18', '2025-08-01')).toBe('2025-08-16')
  })

  it('steps day-by-day inside a multi-day week', () => {
    // From Friday 2025-08-15, a {Wed,Sat} group last met Wednesday 2025-08-13.
    expect(prevMeetingDay([3, 6], '2025-08-15', '2025-08-01')).toBe('2025-08-13')
  })

  it('returns null when the only meeting day in the week is before `min`', () => {
    // From Wednesday 2025-08-20, previous Saturday is 2025-08-16, but min cuts it off.
    expect(prevMeetingDay([6], '2025-08-20', '2025-08-17')).toBeNull()
  })

  it('returns null when `from` is before `min`', () => {
    expect(prevMeetingDay([6], '2025-08-10', '2025-08-15')).toBeNull()
  })
})

describe('nextMeetingDay', () => {
  it('returns the same date when it is already a meeting day', () => {
    expect(nextMeetingDay([6], '2025-08-16', '2025-12-31')).toBe('2025-08-16')
  })

  it('walks forward within one week to the next meeting day', () => {
    // From Monday 2025-08-18, next Saturday is 2025-08-23.
    expect(nextMeetingDay([6], '2025-08-18', '2025-12-31')).toBe('2025-08-23')
  })

  it('steps day-by-day inside a multi-day week', () => {
    // From Monday 2025-08-18, a {Wed,Sat} group next meets Wednesday 2025-08-20.
    expect(nextMeetingDay([3, 6], '2025-08-18', '2025-12-31')).toBe('2025-08-20')
  })

  it('returns null when the next meeting day is past `max`', () => {
    expect(nextMeetingDay([6], '2025-08-18', '2025-08-20')).toBeNull()
  })
})

describe('currentScheduledSessionDate', () => {
  it('is today when today is a meeting day', () => {
    expect(currentScheduledSessionDate([6], '2025-08-16')).toBe('2025-08-16')
    expect(currentScheduledSessionDate([3, 6], '2025-08-13')).toBe('2025-08-13')
  })

  it('is the most recent past meeting day otherwise', () => {
    expect(currentScheduledSessionDate([6], '2025-08-13')).toBe('2025-08-09') // prev Saturday
    expect(currentScheduledSessionDate([3, 6], '2025-08-14')).toBe('2025-08-13') // prev Wednesday
  })
})
