import type { Database } from './database.types'

export type NotificationEventName = Database['public']['Enums']['notification_event']
type Locale = Database['public']['Enums']['locale']

/**
 * Renders a notification centre row's text.
 *
 * The counterpart to `pushBody` in
 * `netlify/functions/lib/notifications.ts`, and deliberately a separate
 * function over a separate block of copy — ADR-015(b)'s two-tier split.
 * A push payload may carry the child's first name and the event type
 * and nothing else, because a lock screen is readable by anyone holding
 * the phone (DPIA R6). These strings are only ever rendered to a
 * recipient who is signed in, so they carry what the Notification Spec
 * originally drafted: the jilid number, the surah, the assignment title
 * and its deadline.
 *
 * That is why the two must not be merged into one "notification text"
 * helper, however similar they look. The similarity is exactly the trap
 * — one helper means one set of strings, and the first person to reuse
 * it puts a surah name on a lock screen.
 *
 * Nothing is stored rendered. A row holds `event` plus a `context`
 * object, and the sentence is built here at read time, so the same
 * notification reads in Dutch or Indonesian depending on who is looking
 * and re-reads correctly if the copy is ever reworded (TAD ADR-017).
 */
export interface NotificationCopy {
  notifications: Record<string, unknown>
}

/**
 * The child's full name is reduced to a first name, matching the push
 * builder — the notification centre is a list of short lines, and a
 * family knows their own children by first name.
 */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? ''
}

/**
 * Which copy key an event renders with.
 *
 * Only one event has more than one: a child with several assignments
 * due tomorrow gets a count rather than one title standing in for all
 * of them. Naming one and dropping the rest is the same mistake as the
 * sibling collision ADR-016(f) fixed, one level down.
 */
export function copyKeyFor(
  event: NotificationEventName,
  context: Record<string, unknown>,
): string {
  if (event === 'assignmentDueTomorrow' && typeof context.count === 'number') {
    return 'notifications.assignmentDueTomorrowMany'
  }
  return `notifications.${event}`
}

/**
 * The interpolation values for a row, as i18next options.
 *
 * `name` always comes from the joined student row rather than from
 * `context`, so a corrected name corrects every notification already
 * written — the reason the name is not stored on the row at all.
 */
export function copyValuesFor(
  childFullName: string,
  context: Record<string, unknown>,
): Record<string, unknown> {
  return { ...context, name: firstName(childFullName) }
}

/** Where tapping a row goes — the same routes the push payloads use. */
export const NOTIFICATION_ROUTE: Record<NotificationEventName, string> = {
  absence: '/attendance',
  newAssignment: '/assignments',
  assignmentDueTomorrow: '/assignments',
  jilidMilestone: '/yanbua',
  surahMemorized: '/murajaah',
  murajaahReminder: '/murajaah',
  reportReady: '/reports',
  weeklyDigest: '/',
}

export type { Locale }
