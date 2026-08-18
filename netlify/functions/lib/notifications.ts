import idCopy from '../../../public/locales/id.json'
import nlCopy from '../../../public/locales/nl.json'
import type { Database } from '../../../src/lib/database.types'

export type Locale = Database['public']['Enums']['locale']

// The recipient rule used to be re-exported from here, keyed on a role.
// It is a relationship now and lives in `src/lib/notificationRecipients.ts`,
// imported directly by the two places that ask it (ADR-022). This module
// builds payloads; who a payload is addressed to is not its question.

/**
 * Every push a family can receive. The names match the keys under
 * `notifications.push` in both locale files — `pushBody()` below relies
 * on that, and `tests/unit/notifications.test.ts` asserts the two sets
 * stay identical in both locales, so adding an event without adding its
 * copy fails the suite rather than shipping an empty notification.
 *
 * Only `absence` is wired to a sender today (`notify-absence.mts`); the
 * rest are built here so the payload rules — and their tests — exist
 * once, before the scheduled Functions that will use them.
 */
export const NOTIFICATION_EVENTS = [
  'absence',
  'newAssignment',
  'assignmentDueTomorrow',
  'jilidMilestone',
  'surahMemorized',
  'murajaahReminder',
  'reportReady',
  'weeklyDigest',
] as const

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]

/**
 * Where tapping the notification lands. Deliberately a route the
 * recipient is authorized to see anyway — the deep link carries no data
 * of its own, so a link leaked with the payload reveals nothing that the
 * app wouldn't already gate behind RLS.
 */
const EVENT_URL: Record<NotificationEvent, string> = {
  absence: '/attendance',
  newAssignment: '/assignments',
  assignmentDueTomorrow: '/assignments',
  jilidMilestone: '/yanbua',
  surahMemorized: '/murajaah',
  murajaahReminder: '/murajaah',
  reportReady: '/reports',
  // The dashboard, where the week the digest is about is actually
  // written out. R6 keeps the attendance figure off the lock screen, so
  // the notification exists to send the family somewhere it can be read
  // — which means that somewhere has to exist. See ADR-016 and
  // `src/features/dashboard/WeeklySummary.tsx`.
  weeklyDigest: '/',
}

const COPY: Record<Locale, { app: { name: string }; notifications: { push: Record<string, string> } }> = {
  id: idCopy,
  nl: nlCopy,
}

/**
 * The *only* child-specific value a push payload can carry.
 *
 * DPIA risk R6 (lock screens are the threat model): a notification may
 * name the child and say what kind of thing happened, and nothing else.
 * No absence reason — that field can carry health data (DPIA R4) — no
 * grades, no page/ayah positions, no tutor notes, no assignment titles.
 *
 * This is enforced structurally rather than by review: `buildPayload`
 * accepts no field that could carry those details, so there is no
 * channel through which one could reach a payload even by mistake. The
 * copy under `notifications.push` is held to the same rule mechanically
 * — the unit suite rejects any string there that interpolates anything
 * other than `{{name}}`.
 *
 * The richer copy the TAD's Notification Spec table drafted (jilid
 * number, surah name, assignment title) is not lost: it stays under
 * `notifications.*` as the *in-app* wording, shown once the recipient is
 * authenticated. See TAD ADR-015.
 */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? ''
}

export interface PayloadInput {
  event: NotificationEvent
  /** The recipient's own `users.locale` — never the sender's, never a default. */
  locale: Locale
  /** The child's `students.full_name`; reduced to a first name here. */
  childFullName: string
  /** Recipient's `users.id`, for the dedup tag. */
  recipientUserId: string
  /** The child's `students.id`, for the dedup tag. Never rendered. */
  studentId: string
  /** Europe/Amsterdam calendar date (YYYY-MM-DD) — see `amsterdamDate`. */
  date: string
}

export interface PushPayload {
  title: string
  body: string
  tag: string
  url: string
  icon: string
}

/**
 * Dedup tag, per (user, event type, **child**, date) — test-plan §4.3.
 *
 * Two jobs. In the browser, a repeat notification with the same tag
 * replaces the earlier one instead of stacking, so a family sees one
 * "not present today" line however many times the pipeline fires. On the
 * server it is the idempotency key that makes an hourly scheduled
 * Function safe to run more than once in a day (TAD ADR-015's DST
 * approach depends on exactly this).
 *
 * The child is in the key, and was not in part 1's version. Keyed on
 * (user, event, date) alone, a parent of two children who were both
 * absent received *one* notification naming *one* of them, because the
 * second replaced the first on the lock screen — silently, with no way
 * for the parent to know a notification had been swallowed. Part 1
 * recorded that as accepted, which it should not have been: it is a
 * parent not being told their child was missing from class. Part 2b's
 * scheduled senders fan out per child by design (a whole class's
 * homework, every family's weekly digest), so it would have stopped
 * being an edge case. Adding the child narrows the key, so every
 * idempotency property it had is preserved: the same child, the same
 * event, on the same local date is still exactly one notification
 * however many times the hourly cron fires. TAD ADR-016.
 */
export function dedupTag(
  event: NotificationEvent,
  recipientUserId: string,
  studentId: string,
  date: string,
): string {
  return `${event}:${recipientUserId}:${studentId}:${date}`
}

function interpolate(template: string, name: string): string {
  return template.replace(/\{\{\s*name\s*\}\}/g, name)
}

export function pushBody(event: NotificationEvent, locale: Locale, childFullName: string): string {
  const template = COPY[locale].notifications.push[event]
  if (!template) throw new Error(`Missing push copy for "${event}" in locale "${locale}"`)
  return interpolate(template, firstName(childFullName))
}

export function buildPayload(input: PayloadInput): PushPayload {
  return {
    title: COPY[input.locale].app.name,
    body: pushBody(input.event, input.locale, input.childFullName),
    tag: dedupTag(input.event, input.recipientUserId, input.studentId, input.date),
    url: EVENT_URL[input.event],
    icon: '/icons/icon-192.png',
  }
}

const AMSTERDAM = 'Europe/Amsterdam'

/**
 * The project's timezone truth, and the reason it exists:
 *
 * Netlify cron expressions are UTC-only, and the TAD's original
 * scheduler table pinned them to CET (`0 17 * * *` = 18:00). That is
 * 19:00 local for the ~7 months of CEST, which covers the whole TPA
 * summer term. Rather than choose which half of the year to be wrong
 * in, the scheduled Functions run *hourly* and decide for themselves
 * whether it is the target hour in Amsterdam — which these two helpers
 * answer correctly on both sides of a DST switch, because the runtime's
 * IANA database, not arithmetic, does the work. TAD ADR-015.
 *
 * `date` is also what the dedup tag is keyed on, so "today" means the
 * family's today, not UTC's.
 */
export function amsterdamDate(now: Date = new Date()): string {
  // en-CA renders ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AMSTERDAM,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function amsterdamHour(now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: AMSTERDAM,
    hour: '2-digit',
    hour12: false,
  }).format(now)
  return Number(hour)
}

/** True when `now` falls in the given Amsterdam local hour (0–23). */
export function isAmsterdamHour(targetHour: number, now: Date = new Date()): boolean {
  return amsterdamHour(now) === targetHour
}

/**
 * Amsterdam local day of week, 0 = Sunday … 6 = Saturday.
 *
 * Derived from `amsterdamDate` rather than from a locale-formatted
 * weekday name, so it cannot drift with the runtime's locale data — and
 * so "Friday" means the Friday the family is living in, not UTC's. Used
 * by `weekly-progress-digest`, whose 08:00 gate falls on the wrong side
 * of midnight in UTC for part of the year.
 */
export function amsterdamWeekday(now: Date = new Date()): number {
  return new Date(`${amsterdamDate(now)}T00:00:00Z`).getUTCDay()
}
