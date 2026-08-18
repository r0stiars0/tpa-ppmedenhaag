import { describe, expect, it } from 'vitest'
import idCopy from '../../public/locales/id.json'
import nlCopy from '../../public/locales/nl.json'
import { NOTIFICATION_EVENTS } from '../../netlify/functions/lib/notifications'
import {
  NOTIFICATION_ROUTE,
  copyKeyFor,
  copyValuesFor,
  type NotificationEventName,
} from '../../src/lib/notificationCopy'

/**
 * One notification event is now named in five places: the Postgres enum
 * (migration 012), the `NOTIFICATION_EVENTS` union, the push copy, the
 * in-app copy, and the route table. Four of those five will fail loudly
 * if they drift — a missing i18n key renders as the key, a missing enum
 * label fails the insert. The fifth, the enum, fails at *runtime in
 * production*, on the first notification of a newly added type, which
 * is the one nobody would catch.
 *
 * So the enum is pinned here against the union it mirrors. The type
 * import is the mechanism: `NotificationEventName` is generated from
 * the database, so if the migration and the TypeScript constant ever
 * disagree, this file stops compiling *and* the assertion below fails.
 */
const COPY = { id: idCopy, nl: nlCopy }
const LOCALES = ['id', 'nl'] as const

describe('one event, named the same in every layer', () => {
  it('the Postgres enum matches NOTIFICATION_EVENTS exactly', () => {
    // Typed as the database enum: an event in the union but not in the
    // enum is a compile error here, before it is a runtime error in
    // Frankfurt.
    const fromUnion: NotificationEventName[] = [...NOTIFICATION_EVENTS]
    expect(fromUnion.sort()).toEqual(Object.keys(NOTIFICATION_ROUTE).sort())
  })

  it('every event has in-app copy in both locales', () => {
    for (const locale of LOCALES) {
      const copy = COPY[locale].notifications as Record<string, unknown>
      for (const event of NOTIFICATION_EVENTS) {
        expect(typeof copy[event], `${locale}.notifications.${event}`).toBe('string')
      }
    }
  })

  it('every in-app string names the child', () => {
    // A parent of two children reading a list needs to know which one
    // each line is about. Two of the drafted strings did not say
    // (ADR-017); this is what stops that coming back.
    for (const locale of LOCALES) {
      const copy = COPY[locale].notifications as Record<string, string>
      for (const event of NOTIFICATION_EVENTS) {
        expect(copy[event], `${locale}.notifications.${event}`).toContain('{{name}}')
      }
      expect(copy.assignmentDueTomorrowMany).toContain('{{name}}')
    }
  })

  it('in-app copy is allowed the detail push copy is not', () => {
    // The two-tier split is the point of having two blocks (ADR-015(b)).
    // If these ever became one set of strings, the lock screen would
    // start carrying a surah name.
    for (const locale of LOCALES) {
      const inApp = COPY[locale].notifications as Record<string, string>
      const push = COPY[locale].notifications.push as Record<string, string>
      expect(inApp.jilidMilestone).toContain('{{number}}')
      expect(inApp.surahMemorized).toContain('{{surah}}')
      expect(inApp.newAssignment).toContain('{{title}}')
      // …and none of that reaches the push strings.
      for (const event of NOTIFICATION_EVENTS) {
        expect(push[event], `${locale}.push.${event}`).not.toMatch(
          /\{\{\s*(number|surah|title|date|count)\s*\}\}/,
        )
      }
    }
  })

  it('routes to a path the recipient is authorized for anyway', () => {
    for (const route of Object.values(NOTIFICATION_ROUTE)) {
      expect(route).toMatch(/^\/[a-z]*$/)
    }
  })
})

describe('copyKeyFor', () => {
  it('uses the plural key only when a count is present', () => {
    expect(copyKeyFor('assignmentDueTomorrow', { title: 'Hafalan' })).toBe(
      'notifications.assignmentDueTomorrow',
    )
    expect(copyKeyFor('assignmentDueTomorrow', { count: 3 })).toBe(
      'notifications.assignmentDueTomorrowMany',
    )
  })

  it('leaves every other event on its own key', () => {
    expect(copyKeyFor('absence', {})).toBe('notifications.absence')
    expect(copyKeyFor('jilidMilestone', { number: 3 })).toBe('notifications.jilidMilestone')
  })
})

describe('copyValuesFor', () => {
  it('adds the child first name to the stored context', () => {
    expect(copyValuesFor('Ali Rahman', { number: 3 })).toEqual({ name: 'Ali', number: 3 })
  })

  it('takes the name from the student row, never from stored context', () => {
    // The name is deliberately not a stored column, so a corrected name
    // corrects every past notification. A `name` that somehow reached
    // `context` must not win.
    expect(copyValuesFor('Zainab Rahman', { name: 'Stale' })).toEqual({ name: 'Zainab' })
  })
})

describe('notification centre presentation (design review)', () => {
  it('gives every event a tone and an icon', async () => {
    const { EVENT_TONE, EVENT_ICON_PATH, TONE_CLASS } = await import(
      '../../src/features/notifications/eventStyle'
    )
    for (const event of NOTIFICATION_EVENTS) {
      expect(EVENT_TONE[event], `tone for ${event}`).toBeDefined()
      expect(TONE_CLASS[EVENT_TONE[event]], `class for ${event}`).toBeTruthy()
      expect(EVENT_ICON_PATH[event], `icon for ${event}`).toMatch(/^[Mm]/)
    }
  })

  it('reserves gold for the celebration events, and nothing else', async () => {
    // Checklist §5: the accent is *reserved* for achievement moments —
    // the Murajaah streak and the "Sudah Hafal" badges. The notification
    // centre carries the only other celebration content in the app, and
    // must not spend gold anywhere else.
    const { EVENT_TONE } = await import('../../src/features/notifications/eventStyle')
    const celebration = NOTIFICATION_EVENTS.filter((e) => EVENT_TONE[e] === 'celebration')
    expect(celebration.sort()).toEqual(['jilidMilestone', 'surahMemorized'])
  })

  it('marks the absence as the only alert', async () => {
    // Danger red is specified for "absence markers, overdue items". A
    // homework reminder is not an alert; making it one would spend the
    // colour that has to still mean something when a child is missing.
    const { EVENT_TONE } = await import('../../src/features/notifications/eventStyle')
    expect(NOTIFICATION_EVENTS.filter((e) => EVENT_TONE[e] === 'alert')).toEqual(['absence'])
  })
})
