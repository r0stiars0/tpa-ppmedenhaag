import type { Database } from './database.types'

type MurajaahFrequency = Database['public']['Enums']['murajaah_frequency']

export const FREQUENCY_LABEL_KEY: Record<MurajaahFrequency, string> = {
  daily: 'murajaah.frequencyDaily',
  '3x_week': 'murajaah.frequency3xWeek',
  weekly: 'murajaah.frequencyWeekly',
}

export const FREQUENCY_OPTIONS: MurajaahFrequency[] = ['daily', '3x_week', 'weekly']

export function isStreakCurrent(latestLogDate: string | null, today: string): boolean {
  if (!latestLogDate) return false
  return latestLogDate === today
}

/* ------------------------------------------------------------------ *
 * Date arithmetic on YYYY-MM-DD strings
 *
 * Every date in this module is a calendar date in the family's own
 * timezone, already resolved to a string by the caller (`amsterdamDate`
 * on the server, the browser's local date in the UI). Doing the
 * arithmetic on the string via a UTC `Date` keeps it away from the
 * host's timezone entirely: a `new Date('2026-03-29')` shifted by
 * `setDate` on a machine in Amsterdam crosses the DST switch and can
 * land on the same day twice, which is precisely the bug this feature
 * is required not to have (test-plan §4.1).
 * ------------------------------------------------------------------ */

const DAY_MS = 86_400_000

function parse(date: string): number {
  return Date.parse(`${date}T00:00:00Z`)
}

function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  return format(parse(date) + days * DAY_MS)
}

/** Monday of the ISO week (Mon–Sun) containing `date`, as YYYY-MM-DD. */
export function weekStart(date: string): string {
  const day = new Date(parse(date)).getUTCDay() // 0 = Sunday
  return addDays(date, day === 0 ? -6 : 1 - day)
}

/**
 * YYYY-MM-DD for the Monday of the local calendar week (Mon–Sun)
 * containing `date`. Used for FR-004's tutor class overview ("this
 * week"'s confirmations) — a fixed Mon-Sun window rather than a rolling
 * 7-day lookback, so the overview resets predictably at the same point
 * every week regardless of what day the tutor happens to open it.
 */
export function startOfWeekLocalDate(date: Date = new Date()): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return weekStart(`${yyyy}-${mm}-${dd}`)
}

/* ------------------------------------------------------------------ *
 * Streaks
 * ------------------------------------------------------------------ */

/**
 * Streaks are **derived from the log, not stored** — TAD ADR-016.
 *
 * Until migration 011 the streak was a `murajaah_log.streak_count`
 * column written by the `fn_set_streak_count` trigger, which could only
 * ever change when a *new* confirmation arrived. That made the number
 * unfalsifiable between confirmations: a row from three days ago
 * reading `streak_count = 7` described a run that had already been
 * broken, and the database had no way to know. The original plan was a
 * nightly `calculate-streak-resets` job to zero those rows; deriving the
 * streak on read removes the reason for such a job to exist, so the
 * column, the trigger and the job all went together.
 *
 * The trigger also only understood *days*, while a target carries a
 * `frequency`. A `3x_week` target confirmed Monday, Wednesday and
 * Friday every week for a year had a stored streak of 1 — three
 * separate runs of one, because no two confirmations were on
 * consecutive days. Here the unit of a streak is the **period the
 * frequency actually asks for**:
 *
 * | frequency  | period          | kept alive by      |
 * |------------|-----------------|--------------------|
 * | `daily`    | one day         | 1 confirmation     |
 * | `3x_week`  | one week Mon–Sun| 3 confirmations    |
 * | `weekly`   | one week Mon–Sun| 1 confirmation     |
 *
 * The streak is the number of consecutive periods, counting backwards,
 * that met their target. Counting starts at the *current* period if it
 * has already been met, and otherwise at the previous one — the grace
 * that matters in practice, since a family opening the app on Tuesday
 * morning has not yet missed Tuesday. A period that was missed outright
 * ends the count, so a `daily` target last confirmed the day before
 * yesterday reads 0, which is what PRD AC-003 asks for and what the
 * stored column could not do.
 */
const PERIOD_DAYS: Record<MurajaahFrequency, number> = {
  daily: 1,
  '3x_week': 7,
  weekly: 7,
}

const CONFIRMATIONS_REQUIRED: Record<MurajaahFrequency, number> = {
  daily: 1,
  '3x_week': 3,
  weekly: 1,
}

export interface StreakInput {
  /** Dates a confirmation was logged, YYYY-MM-DD. Order and duplicates don't matter. */
  logDates: readonly string[]
  frequency: MurajaahFrequency
  /** Today's calendar date in the family's timezone, YYYY-MM-DD. */
  today: string
  /**
   * The date the target was assigned. Optional, and only affects the
   * period it falls in: a `3x_week` target assigned on a Saturday
   * cannot be confirmed three times that week, so it asks for two —
   * test-plan §4.1's "assignment created mid-week" case. Without it the
   * family's very first week would count as missed however diligent
   * they were.
   */
  since?: string | null
}

/** First day of the period containing `date`. */
export function periodStart(date: string, frequency: MurajaahFrequency): string {
  return PERIOD_DAYS[frequency] === 1 ? date : weekStart(date)
}

function previousPeriod(start: string, frequency: MurajaahFrequency): string {
  return addDays(start, -PERIOD_DAYS[frequency])
}

function periodEnd(start: string, frequency: MurajaahFrequency): string {
  return addDays(start, PERIOD_DAYS[frequency] - 1)
}

/**
 * Confirmations this period needs, reduced only for a period the target
 * did not exist for the whole of. Never reduced below 1 — a period that
 * asks for nothing would count as met with no confirmations at all, and
 * a streak of untouched periods is worse than no streak.
 */
function requiredIn(start: string, frequency: MurajaahFrequency, since?: string | null): number {
  const required = CONFIRMATIONS_REQUIRED[frequency]
  if (!since || since <= start) return required
  const end = periodEnd(start, frequency)
  if (since > end) return required
  const available = Math.round((parse(end) - parse(since)) / DAY_MS) + 1
  return Math.max(1, Math.min(required, available))
}

function countIn(start: string, frequency: MurajaahFrequency, dates: Set<string>): number {
  let count = 0
  for (let i = 0; i < PERIOD_DAYS[frequency]; i += 1) {
    if (dates.has(addDays(start, i))) count += 1
  }
  return count
}

export interface PeriodState {
  /** First day of the period, YYYY-MM-DD. */
  start: string
  /** Distinct days confirmed in it so far. */
  confirmed: number
  /** Confirmations it takes to keep the streak alive. */
  required: number
  /** Days left to reach `required`, counting today. */
  daysRemaining: number
}

/** Where the family stands in the period they are currently in. */
export function currentPeriod(input: StreakInput): PeriodState {
  const { frequency, today, since } = input
  const start = periodStart(today, frequency)
  const dates = new Set(input.logDates)
  const elapsed = Math.round((parse(today) - parse(start)) / DAY_MS)
  return {
    start,
    confirmed: countIn(start, frequency, dates),
    required: requiredIn(start, frequency, since),
    daysRemaining: PERIOD_DAYS[frequency] - elapsed,
  }
}

export function computeStreak(input: StreakInput): number {
  const { frequency, today, since } = input
  const dates = new Set(input.logDates)
  const met = (start: string) =>
    countIn(start, frequency, dates) >= requiredIn(start, frequency, since)

  // A period still open cannot have been missed yet, so an unmet
  // current period doesn't break the run — it just isn't part of it.
  let cursor = periodStart(today, frequency)
  if (!met(cursor)) cursor = previousPeriod(cursor, frequency)

  const floor = since ? periodStart(since, frequency) : null
  let streak = 0
  while ((floor === null || cursor >= floor) && met(cursor)) {
    streak += 1
    cursor = previousPeriod(cursor, frequency)
  }
  return streak
}

/**
 * The longest run the family has ever had. Kept because the family view
 * shows it whenever it beats the current one — losing a 30-day run to
 * one bad week shouldn't erase the fact that it happened (PRD FR-003's
 * "the historical streak is preserved in records").
 */
export function computeBestStreak(input: StreakInput): number {
  const { frequency, today, since } = input
  if (input.logDates.length === 0) return 0
  const dates = new Set(input.logDates)

  let earliest = input.logDates[0]
  for (const date of input.logDates) if (date < earliest) earliest = date

  const last = periodStart(today, frequency)
  let best = 0
  let run = 0
  for (
    let cursor = periodStart(earliest, frequency);
    cursor <= last;
    cursor = addDays(cursor, PERIOD_DAYS[frequency])
  ) {
    const complete = countIn(cursor, frequency, dates) >= requiredIn(cursor, frequency, since)
    run = complete ? run + 1 : 0
    if (run > best) best = run
  }
  return best
}

/**
 * Whether tonight's reminder should go out for this target — the whole
 * decision `send-murajaah-reminders` makes, kept here as a pure
 * function so it can be tested per frequency without a push service.
 *
 * The rule is "remind them on the last evening they can still make it":
 * a family is interrupted exactly when skipping today would cost them
 * the streak, and not before. For `daily` that is every evening
 * practice hasn't been confirmed, which is FR-006 as written. For
 * `3x_week` it is the evening the days left drop to the confirmations
 * still owed — Friday if they've done none, Sunday if they've done two.
 * For `weekly` it is Sunday. A family that is comfortably on track is
 * not notified at all, which is the difference between a reminder and
 * nagging, and the reason a family keeps notifications switched on.
 */
export function needsReminder(input: StreakInput): boolean {
  const period = currentPeriod(input)
  const outstanding = period.required - period.confirmed
  return outstanding > 0 && period.daysRemaining <= outstanding
}
