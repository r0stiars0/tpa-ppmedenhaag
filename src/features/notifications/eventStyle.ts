import type { NotificationEventName } from '../../lib/notificationCopy'

/**
 * How a notification row is presented, per event.
 *
 * From the design review of the notification centre (PRD §1 "Design
 * Validation", checklist §5). The screen shipped semantically flat — an
 * absence, a finished jilid and a weekly summary all rendered as the
 * same grey card — which wasted the one thing the palette is specified
 * to carry. PRD §1 assigns meaning to these colours, and this table is
 * where the notification centre finally uses it:
 *
 *   - **danger** (#D32F2F) — "absence markers, overdue items"
 *   - **accent / gold** (#C8A415) — "achievement badges … milestone /
 *     celebration moments", and checklist §5 keeps it *reserved* for
 *     those. The centre carries the only celebration content in the app
 *     outside Murajaah's streak and the "Sudah Hafal" badges, so this is
 *     exactly where it belongs — and rendering it grey was the review's
 *     sharpest finding.
 *   - **primary** (#0D50A0) — everything informational.
 *
 * Success green is deliberately unused: nothing here reports a
 * completion by the child. Green would compete with gold for "good
 * news" and blur a distinction the rest of the app keeps sharp.
 *
 * Tones are grouped rather than one-per-event on purpose. Eight colours
 * is not a language, it is decoration; three is something a parent can
 * learn without being taught.
 */
export type NotificationTone = 'alert' | 'celebration' | 'info'

/** Matches the badge-class convention in `murajaah/quality.ts` and its siblings. */
export const TONE_CLASS: Record<NotificationTone, string> = {
  alert: 'bg-ppme-danger/10 text-ppme-danger',
  celebration: 'bg-ppme-accent/15 text-ppme-accent',
  info: 'bg-ppme-primary/10 text-ppme-primary',
}

export const EVENT_TONE: Record<NotificationEventName, NotificationTone> = {
  absence: 'alert',
  newAssignment: 'info',
  assignmentDueTomorrow: 'info',
  jilidMilestone: 'celebration',
  surahMemorized: 'celebration',
  murajaahReminder: 'info',
  reportReady: 'info',
  weeklyDigest: 'info',
}

/**
 * A single glyph per event, drawn from the tab bar's own vocabulary so a
 * row points at a place in the app rather than introducing a second
 * iconography: a calendar for attendance, a clipboard for homework, a
 * star for a milestone, a book for Murajaah, a document for the report.
 *
 * Paths only — the component supplies the SVG wrapper, so stroke width
 * and sizing stay in one place.
 */
export const EVENT_ICON_PATH: Record<NotificationEventName, string> = {
  // calendar with a slash — a session the child was not at
  absence:
    'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM9 15l6 4M15 15l-6 4',
  // clipboard
  newAssignment:
    'M9 4h6v3H9zM9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 12h6M9 16h4',
  // clipboard with a clock hand — due tomorrow
  assignmentDueTomorrow:
    'M9 4h6v3H9zM9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M12 12v3l2 1',
  // star
  jilidMilestone: 'M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 16.8 6.7 19.7l1.1-6.1L3.4 9.4l6-.8L12 3Z',
  surahMemorized: 'M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 16.8 6.7 19.7l1.1-6.1L3.4 9.4l6-.8L12 3Z',
  // open book
  murajaahReminder: 'M12 6.5C10.5 5 8.5 4.5 4 4.5v13c4.5 0 6.5.5 8 2 1.5-1.5 3.5-2 8-2v-13c-4.5 0-6.5.5-8 2ZM12 6.5v13',
  // document
  reportReady: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 13h6M9 17h4',
  // bar chart — the week in summary
  weeklyDigest: 'M4 20h16M8 20v-6M12 20V8M16 20v-9',
}
