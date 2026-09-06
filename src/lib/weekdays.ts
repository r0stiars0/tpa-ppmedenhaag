/* ------------------------------------------------------------------ *
 * Weekday helpers — a group's meeting days (classes.meeting_days,
 * migration 019 / TAD ADR-037).
 *
 * Wire format everywhere: `dow` integers, 0 = Sunday … 6 = Saturday.
 * That is what `Date#getDay()` and Postgres `extract(dow from …)`
 * return, and the numbering `src/lib/murajaah.ts` already uses — so a
 * meeting day stored in the column, compared in the trigger and shown
 * in the browser never needs converting.
 *
 * Dependency-free (same rule as `reports.ts`): no imports, so a Netlify
 * Function could reuse it. Date arithmetic is done on YYYY-MM-DD
 * strings via a UTC `Date`, keeping it away from the host timezone and
 * the DST bug test-plan §4.1 calls out.
 * ------------------------------------------------------------------ */

export type Dow = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Monday-first, for rendering. Storage and comparisons stay ascending. */
export const DISPLAY_ORDER: readonly Dow[] = [1, 2, 3, 4, 5, 6, 0]

/** dow (index) → i18n key under the `days` namespace, e.g. `days.sat.long`. */
export const DOW_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

const DAY_MS = 86_400_000

function parseDate(date: string): number {
  return Date.parse(`${date}T00:00:00Z`)
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  return formatDate(parseDate(date) + days * DAY_MS)
}

/** The `dow` (0=Sun) of a YYYY-MM-DD calendar date, timezone-stable. */
export function dowOf(isoDate: string): Dow {
  return new Date(parseDate(isoDate)).getUTCDay() as Dow
}

/** The host-local `dow` of a `Date` (defaults to now). */
export function todayDow(d: Date = new Date()): Dow {
  return d.getDay() as Dow
}

/** Ascending, de-duplicated, anything outside 0–6 dropped. */
export function normaliseDows(days: readonly number[]): Dow[] {
  return [...new Set(days)]
    .filter((d): d is Dow => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b)
}

export function isMeetingDay(days: readonly number[], isoDate: string): boolean {
  return days.includes(dowOf(isoDate))
}

/**
 * Monday-first locale label list, e.g. "Za, Zo" / "Sb, Ah". `t` is
 * i18next's `t`; keys are `days.<mon|tue|…>.short` and `.long`.
 */
export function formatDayList(
  days: readonly number[],
  t: (key: string) => string,
  style: 'short' | 'long' = 'short',
): string {
  return DISPLAY_ORDER.filter((d) => days.includes(d))
    .map((d) => t(`days.${DOW_KEY[d]}.${style}`))
    .join(', ')
}

/**
 * Nearest date on or before `from` whose `dow` is in `days`, not earlier
 * than `min`. A valid non-empty `days` has a meeting day every 7 calendar
 * days, so a 7-step scan settles it; `null` means there is none in
 * `[min, from]`.
 */
export function prevMeetingDay(
  days: readonly number[],
  from: string,
  min: string,
): string | null {
  if (parseDate(from) < parseDate(min)) return null
  let cursor = from
  for (let i = 0; i < 7; i++) {
    if (parseDate(cursor) < parseDate(min)) return null
    if (days.includes(dowOf(cursor))) return cursor
    cursor = addDays(cursor, -1)
  }
  return null
}

/**
 * Nearest date on or after `from` whose `dow` is in `days`, not later
 * than `max`. `null` means there is none in `[from, max]`.
 */
export function nextMeetingDay(
  days: readonly number[],
  from: string,
  max: string,
): string | null {
  if (parseDate(from) > parseDate(max)) return null
  let cursor = from
  for (let i = 0; i < 7; i++) {
    if (parseDate(cursor) > parseDate(max)) return null
    if (days.includes(dowOf(cursor))) return cursor
    cursor = addDays(cursor, 1)
  }
  return null
}

/**
 * The session a tutor is expected to be recording right now: `today` if
 * it is a meeting day, otherwise the most recent past meeting day.
 * Assumes `days` is valid and non-empty (the column CHECK guarantees it),
 * so a result is always found within the last week.
 */
export function currentScheduledSessionDate(days: readonly number[], today: string): string {
  return prevMeetingDay(days, today, addDays(today, -7)) ?? today
}

/** Exposed only so callers doing their own stepping share the string math. */
export { addDays }
