import { describe, expect, it } from 'vitest'
import {
  computeBestStreak,
  computeStreak,
  currentPeriod,
  isStreakCurrent,
  needsReminder,
  startOfWeekLocalDate,
} from '../../src/lib/murajaah'

describe('isStreakCurrent', () => {
  it('is current when the latest log date is today', () => {
    expect(isStreakCurrent('2026-08-12', '2026-08-12')).toBe(true)
  })

  it('is not current when the latest log date is before today', () => {
    expect(isStreakCurrent('2026-08-10', '2026-08-12')).toBe(false)
  })

  it('is not current when there is no log at all', () => {
    expect(isStreakCurrent(null, '2026-08-12')).toBe(false)
  })
})

describe('startOfWeekLocalDate', () => {
  it('returns the same date when given a Monday', () => {
    expect(startOfWeekLocalDate(new Date('2026-08-10T09:00:00'))).toBe('2026-08-10')
  })

  it('returns the preceding Monday for a mid-week date', () => {
    expect(startOfWeekLocalDate(new Date('2026-08-12T09:00:00'))).toBe('2026-08-10')
  })

  it('returns the preceding Monday for a Sunday (end of the Mon-Sun week)', () => {
    expect(startOfWeekLocalDate(new Date('2026-08-16T09:00:00'))).toBe('2026-08-10')
  })
})

/**
 * TAD ADR-016 / test-plan §4.1. The week of Mon 2026-08-10 – Sun
 * 2026-08-16 is used throughout so the weekday of every date is
 * readable from the fixture: 10 Mon, 11 Tue, 12 Wed, 13 Thu, 14 Fri,
 * 15 Sat, 16 Sun.
 */
describe('computeStreak — daily', () => {
  const daily = { frequency: 'daily' as const }

  it('counts consecutive days ending today (1 → 2 → 3)', () => {
    expect(computeStreak({ ...daily, today: '2026-08-12', logDates: ['2026-08-12'] })).toBe(1)
    expect(
      computeStreak({ ...daily, today: '2026-08-12', logDates: ['2026-08-11', '2026-08-12'] }),
    ).toBe(2)
    expect(
      computeStreak({
        ...daily,
        today: '2026-08-12',
        logDates: ['2026-08-10', '2026-08-11', '2026-08-12'],
      }),
    ).toBe(3)
  })

  it('keeps the run alive on a day not yet confirmed — today is still open', () => {
    expect(
      computeStreak({ ...daily, today: '2026-08-12', logDates: ['2026-08-10', '2026-08-11'] }),
    ).toBe(2)
  })

  it('resets to 0 once a whole day has been missed (PRD AC-003)', () => {
    // Confirmed up to Monday, nothing Tuesday, and it is now Wednesday:
    // Tuesday is over and was missed.
    expect(
      computeStreak({ ...daily, today: '2026-08-12', logDates: ['2026-08-09', '2026-08-10'] }),
    ).toBe(0)
  })

  it('counts only the run ending now, not an older longer one', () => {
    expect(
      computeStreak({
        ...daily,
        today: '2026-08-12',
        logDates: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-12'],
      }),
    ).toBe(1)
  })

  it('is 0 with no confirmations at all', () => {
    expect(computeStreak({ ...daily, today: '2026-08-12', logDates: [] })).toBe(0)
  })

  it('is unaffected by duplicate or unordered dates', () => {
    expect(
      computeStreak({
        ...daily,
        today: '2026-08-12',
        logDates: ['2026-08-12', '2026-08-10', '2026-08-11', '2026-08-11'],
      }),
    ).toBe(3)
  })

  it('counts across the spring DST switch (Sun 2026-03-29, 02:00 → 03:00)', () => {
    expect(
      computeStreak({
        ...daily,
        today: '2026-03-30',
        logDates: ['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30'],
      }),
    ).toBe(4)
  })

  it('counts across the autumn DST switch (Sun 2026-10-25, 03:00 → 02:00)', () => {
    expect(
      computeStreak({
        ...daily,
        today: '2026-10-26',
        logDates: ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'],
      }),
    ).toBe(4)
  })

  it('counts across a month and a year boundary', () => {
    expect(
      computeStreak({
        ...daily,
        today: '2027-01-01',
        logDates: ['2026-12-30', '2026-12-31', '2027-01-01'],
      }),
    ).toBe(3)
  })
})

describe('computeStreak — 3x_week', () => {
  const thrice = { frequency: '3x_week' as const }

  it('counts a week met with three confirmations, however they are spaced', () => {
    // Mon/Wed/Fri — three separate days, never consecutive. The old
    // stored streak_count called this a run of 1.
    expect(
      computeStreak({
        ...thrice,
        today: '2026-08-16',
        logDates: ['2026-08-10', '2026-08-12', '2026-08-14'],
      }),
    ).toBe(1)
  })

  it('counts consecutive met weeks', () => {
    expect(
      computeStreak({
        ...thrice,
        today: '2026-08-16',
        logDates: [
          '2026-08-03',
          '2026-08-05',
          '2026-08-07',
          '2026-08-10',
          '2026-08-12',
          '2026-08-14',
        ],
      }),
    ).toBe(2)
  })

  it('does not count a week with only two confirmations', () => {
    expect(
      computeStreak({ ...thrice, today: '2026-08-16', logDates: ['2026-08-10', '2026-08-12'] }),
    ).toBe(0)
  })

  it('holds the previous week while this week is still short of three', () => {
    expect(
      computeStreak({
        ...thrice,
        today: '2026-08-11', // Tuesday, one confirmation in so far
        logDates: ['2026-08-03', '2026-08-05', '2026-08-07', '2026-08-10'],
      }),
    ).toBe(1)
  })

  it('drops a week that ended two short', () => {
    expect(
      computeStreak({
        ...thrice,
        today: '2026-08-11',
        logDates: ['2026-08-03', '2026-08-05', '2026-08-10'],
      }),
    ).toBe(0)
  })

  it('asks for fewer confirmations in the week the target was assigned', () => {
    // Assigned Saturday: only Sat and Sun exist, so two confirmations
    // meet that week (test-plan §4.1, "assignment created mid-week").
    expect(
      computeStreak({
        ...thrice,
        today: '2026-08-16',
        since: '2026-08-15',
        logDates: ['2026-08-15', '2026-08-16'],
      }),
    ).toBe(1)
  })

  it('never lets proration make an untouched week count', () => {
    // Assigned Sunday, nothing confirmed: one is still required.
    expect(
      computeStreak({ ...thrice, today: '2026-08-16', since: '2026-08-16', logDates: [] }),
    ).toBe(0)
  })

  it('does not count weeks before the target existed', () => {
    expect(
      computeStreak({
        ...thrice,
        today: '2026-08-16',
        since: '2026-08-10',
        logDates: ['2026-08-10', '2026-08-12', '2026-08-14'],
      }),
    ).toBe(1)
  })
})

describe('computeStreak — weekly', () => {
  const weekly = { frequency: 'weekly' as const }

  it('counts consecutive weeks with at least one confirmation', () => {
    expect(
      computeStreak({
        ...weekly,
        today: '2026-08-13',
        logDates: ['2026-07-30', '2026-08-06', '2026-08-11'],
      }),
    ).toBe(3)
  })

  it('holds the run while the current week is still empty', () => {
    expect(
      computeStreak({ ...weekly, today: '2026-08-13', logDates: ['2026-07-30', '2026-08-06'] }),
    ).toBe(2)
  })

  it('breaks on a whole week skipped', () => {
    expect(
      computeStreak({ ...weekly, today: '2026-08-13', logDates: ['2026-07-28', '2026-08-11'] }),
    ).toBe(1)
  })
})

describe('currentPeriod', () => {
  it('describes today for a daily target', () => {
    expect(
      currentPeriod({ frequency: 'daily', today: '2026-08-12', logDates: ['2026-08-12'] }),
    ).toEqual({ start: '2026-08-12', confirmed: 1, required: 1, daysRemaining: 1 })
  })

  it('counts down the days left in the week', () => {
    const args = { frequency: '3x_week' as const, logDates: ['2026-08-10'] }
    expect(currentPeriod({ ...args, today: '2026-08-10' }).daysRemaining).toBe(7)
    expect(currentPeriod({ ...args, today: '2026-08-14' }).daysRemaining).toBe(3)
    expect(currentPeriod({ ...args, today: '2026-08-16' }).daysRemaining).toBe(1)
  })

  it('reports the reduced requirement for the week a target was assigned', () => {
    expect(
      currentPeriod({
        frequency: '3x_week',
        today: '2026-08-16',
        since: '2026-08-15',
        logDates: [],
      }).required,
    ).toBe(2)
  })
})

describe('needsReminder', () => {
  it('reminds every evening a daily target is unconfirmed', () => {
    expect(needsReminder({ frequency: 'daily', today: '2026-08-12', logDates: [] })).toBe(true)
  })

  it('stays quiet once a daily target is confirmed', () => {
    expect(
      needsReminder({ frequency: 'daily', today: '2026-08-12', logDates: ['2026-08-12'] }),
    ).toBe(false)
  })

  it('leaves a 3x_week target alone until skipping today would cost the week', () => {
    const empty = { frequency: '3x_week' as const, logDates: [] }
    expect(needsReminder({ ...empty, today: '2026-08-10' })).toBe(false) // Mon, 7 days left
    expect(needsReminder({ ...empty, today: '2026-08-13' })).toBe(false) // Thu, 4 left
    expect(needsReminder({ ...empty, today: '2026-08-14' })).toBe(true) // Fri, 3 left for 3
  })

  it('moves the 3x_week reminder later as confirmations come in', () => {
    const two = { frequency: '3x_week' as const, logDates: ['2026-08-10', '2026-08-11'] }
    expect(needsReminder({ ...two, today: '2026-08-14' })).toBe(false) // Fri, 3 left for 1
    expect(needsReminder({ ...two, today: '2026-08-16' })).toBe(true) // Sun, last chance
  })

  it('stays quiet for the rest of a 3x_week week already met', () => {
    expect(
      needsReminder({
        frequency: '3x_week',
        today: '2026-08-16',
        logDates: ['2026-08-10', '2026-08-11', '2026-08-12'],
      }),
    ).toBe(false)
  })

  it('reminds a weekly target on Sunday only', () => {
    const empty = { frequency: 'weekly' as const, logDates: [] }
    expect(needsReminder({ ...empty, today: '2026-08-14' })).toBe(false)
    expect(needsReminder({ ...empty, today: '2026-08-16' })).toBe(true)
  })

  it('respects the reduced requirement of the assignment week', () => {
    // Assigned Saturday, needs 2, one done: Sunday is the last chance.
    expect(
      needsReminder({
        frequency: '3x_week',
        today: '2026-08-16',
        since: '2026-08-15',
        logDates: ['2026-08-15'],
      }),
    ).toBe(true)
  })
})

describe('computeBestStreak', () => {
  it('is 0 with no history', () => {
    expect(computeBestStreak({ frequency: 'daily', today: '2026-08-12', logDates: [] })).toBe(0)
  })

  it('keeps the longest past run after the current one is broken', () => {
    expect(
      computeBestStreak({
        frequency: 'daily',
        today: '2026-08-12',
        logDates: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-12'],
      }),
    ).toBe(4)
  })

  it('includes a run that is still going', () => {
    const logDates = ['2026-08-10', '2026-08-11', '2026-08-12']
    expect(computeBestStreak({ frequency: 'daily', today: '2026-08-12', logDates })).toBe(3)
  })

  it('does not lose a live run to an unconfirmed today', () => {
    const logDates = ['2026-08-10', '2026-08-11']
    expect(computeBestStreak({ frequency: 'daily', today: '2026-08-12', logDates })).toBe(2)
    expect(computeStreak({ frequency: 'daily', today: '2026-08-12', logDates })).toBe(2)
  })

  it('counts weeks for a weekly target', () => {
    expect(
      computeBestStreak({
        frequency: 'weekly',
        today: '2026-08-13',
        logDates: ['2026-07-06', '2026-07-13', '2026-07-20', '2026-08-11'],
      }),
    ).toBe(3)
  })
})
