import { describe, expect, it } from 'vitest'
import idCopy from '../../public/locales/id.json'
import nlCopy from '../../public/locales/nl.json'
import {
  NOTIFICATION_EVENTS,
  amsterdamDate,
  amsterdamHour,
  buildPayload,
  dedupTag,
  firstName,
  isAmsterdamHour,
  pushBody,
  type Locale,
  type NotificationEvent,
} from '../../netlify/functions/lib/notifications'

const LOCALES: Locale[] = ['id', 'nl']
const COPY = { id: idCopy, nl: nlCopy }

describe('push copy coverage', () => {
  it('every event has copy in every locale, and nothing extra', () => {
    for (const locale of LOCALES) {
      const keys = Object.keys(COPY[locale].notifications.push).sort()
      expect(keys, `locale ${locale}`).toEqual([...NOTIFICATION_EVENTS].sort())
    }
  })
})

describe('payload renders in the recipient locale (test-plan §4.3)', () => {
  it('picks the body from the recipient locale, not a default', () => {
    const args = { childFullName: 'Yusuf Rahman', recipientUserId: 'u1', date: '2026-03-10' }

    const id = buildPayload({ event: 'absence', locale: 'id', ...args })
    const nl = buildPayload({ event: 'absence', locale: 'nl', ...args })

    expect(id.body).toBe('Yusuf tidak hadir hari ini di TPA')
    expect(nl.body).toBe('Yusuf was vandaag niet aanwezig bij TPA')
    expect(id.body).not.toBe(nl.body)
  })

  it('renders every event in both locales with the name interpolated', () => {
    for (const event of NOTIFICATION_EVENTS) {
      for (const locale of LOCALES) {
        const body = pushBody(event, locale, 'Aisyah Putri')
        expect(body, `${event}/${locale}`).toContain('Aisyah')
        expect(body, `${event}/${locale}`).not.toContain('{{')
      }
    }
  })

  it('titles the notification with the app name, localized', () => {
    const args = { event: 'absence' as const, childFullName: 'Yusuf', recipientUserId: 'u1', date: '2026-03-10' }
    expect(buildPayload({ ...args, locale: 'id' }).title).toBe('TPA PPME Den Haag')
    expect(buildPayload({ ...args, locale: 'nl' }).title).toBe('TPA PPME Den Haag')
  })
})

describe('DPIA risk R6 — lock-screen content limits', () => {
  it('carries the first name only, never the full name', () => {
    expect(firstName('Yusuf Rahman Abdullah')).toBe('Yusuf')
    expect(firstName('  Aisyah   Putri  ')).toBe('Aisyah')
    expect(firstName('Fatima')).toBe('Fatima')

    const payload = buildPayload({
      event: 'absence',
      locale: 'id',
      childFullName: 'Yusuf Rahman Abdullah',
      recipientUserId: 'u1',
      studentId: 'child-1',
      date: '2026-03-10',
    })
    expect(payload.body).toContain('Yusuf')
    expect(payload.body).not.toContain('Rahman')
    expect(payload.body).not.toContain('Abdullah')
  })

  it('every push string interpolates the child name and nothing else', () => {
    // The structural guarantee is that `buildPayload` has no parameter
    // that could carry a reason, grade or position. This is the other
    // half: copy cannot smuggle one in through a placeholder either.
    for (const locale of LOCALES) {
      for (const [event, template] of Object.entries(COPY[locale].notifications.push)) {
        const placeholders = [...template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1])
        expect(placeholders, `${event}/${locale}`).toEqual(['name'])
      }
    }
  })

  it('no push payload can express an absence reason, grade or progress detail', () => {
    // A reason field on the source row must have nowhere to go: the only
    // child-specific input accepted is the name.
    const payload = buildPayload({
      event: 'absence',
      locale: 'nl',
      childFullName: 'Yusuf Rahman',
      recipientUserId: 'u1',
      studentId: 'child-1',
      date: '2026-03-10',
    })
    const serialized = JSON.stringify(payload)
    for (const leak of ['ziek', 'sakit', 'koorts', 'Jilid 3', 'halaman', 'ayat', '8.5']) {
      expect(serialized, `payload leaked "${leak}"`).not.toContain(leak)
    }
    expect(Object.keys(payload).sort()).toEqual(['body', 'icon', 'tag', 'title', 'url'])
  })

  it('deep-links to a route, carrying no data in the URL', () => {
    for (const event of NOTIFICATION_EVENTS) {
      const { url } = buildPayload({
        event,
        locale: 'id',
        childFullName: 'Yusuf',
        recipientUserId: 'u1',
        studentId: 'child-1',
        date: '2026-03-10',
      })
      // A bare route and nothing else: no query string, no id, no
      // fragment. `/` is the dashboard, where the weekly digest lands.
      expect(url, event).toMatch(/^\/[a-z]*$/)
    }
  })
})

describe('dedup tag (test-plan §4.3)', () => {
  it('is stable per (user, event type, child, date)', () => {
    expect(dedupTag('absence', 'user-1', 'child-1', '2026-03-10')).toBe(
      'absence:user-1:child-1:2026-03-10',
    )
    expect(dedupTag('absence', 'user-1', 'child-1', '2026-03-10')).toBe(
      dedupTag('absence', 'user-1', 'child-1', '2026-03-10'),
    )
  })

  it('differs across user, event type, child and date', () => {
    const base = dedupTag('absence', 'user-1', 'child-1', '2026-03-10')
    expect(dedupTag('absence', 'user-2', 'child-1', '2026-03-10')).not.toBe(base)
    expect(dedupTag('murajaahReminder', 'user-1', 'child-1', '2026-03-10')).not.toBe(base)
    expect(dedupTag('absence', 'user-1', 'child-2', '2026-03-10')).not.toBe(base)
    expect(dedupTag('absence', 'user-1', 'child-1', '2026-03-11')).not.toBe(base)
  })

  it('is carried on the payload the browser sees', () => {
    const payload = buildPayload({
      event: 'absence',
      locale: 'id',
      childFullName: 'Yusuf',
      recipientUserId: 'user-1',
      studentId: 'child-1',
      date: '2026-03-10',
    })
    expect(payload.tag).toBe('absence:user-1:child-1:2026-03-10')
  })

  it('gives two children of the same parent two notifications, not one', () => {
    // The regression this key shape exists to prevent (ADR-016). Same
    // tag ⇒ the browser replaces rather than stacks, so keying without
    // the child meant a parent of two absent children was told about
    // one of them and never knew about the other.
    const ali = dedupTag('absence', 'parent-1', 'child-ali', '2026-03-10')
    const zainab = dedupTag('absence', 'parent-1', 'child-zainab', '2026-03-10')
    expect(ali).not.toBe(zainab)
  })

  it('still collapses a repeated run for the same child on the same day', () => {
    // The property the hourly-cron design depends on: re-running is free.
    expect(dedupTag('murajaahReminder', 'parent-1', 'child-ali', '2026-03-10')).toBe(
      dedupTag('murajaahReminder', 'parent-1', 'child-ali', '2026-03-10'),
    )
  })
})

describe('Amsterdam local time across the DST switch (test-plan §4.1)', () => {
  // 2026: CEST starts Sun 29 March 02:00 CET, ends Sun 25 October 03:00 CEST.
  it('resolves the local date, not the UTC one', () => {
    // 22:30 UTC on 9 March is already 23:30 CET the same day...
    expect(amsterdamDate(new Date('2026-03-09T22:30:00Z'))).toBe('2026-03-09')
    // ...but 23:30 UTC is 00:30 CET on the 10th.
    expect(amsterdamDate(new Date('2026-03-09T23:30:00Z'))).toBe('2026-03-10')
    // In CEST the offset is 2h, so the day rolls over an hour earlier in UTC.
    expect(amsterdamDate(new Date('2026-07-09T22:30:00Z'))).toBe('2026-07-10')
  })

  it('18:00 local is 17:00 UTC in winter and 16:00 UTC in summer', () => {
    // A CET date — the TAD's original `0 17 * * *` is correct here...
    expect(amsterdamHour(new Date('2026-01-15T17:00:00Z'))).toBe(18)
    expect(isAmsterdamHour(18, new Date('2026-01-15T17:00:00Z'))).toBe(true)

    // ...and an hour late here, which is the bug the hourly-gate approach
    // exists to avoid: on a CEST date 17:00 UTC is 19:00 local.
    expect(amsterdamHour(new Date('2026-07-15T17:00:00Z'))).toBe(19)
    expect(isAmsterdamHour(18, new Date('2026-07-15T17:00:00Z'))).toBe(false)
    expect(isAmsterdamHour(18, new Date('2026-07-15T16:00:00Z'))).toBe(true)
  })

  it('is right on both switchover days themselves', () => {
    // Last Sunday of March 2026 (CET → CEST): 16:00 UTC is 18:00 local.
    expect(isAmsterdamHour(18, new Date('2026-03-29T16:00:00Z'))).toBe(true)
    expect(isAmsterdamHour(18, new Date('2026-03-29T17:00:00Z'))).toBe(false)
    // Last Sunday of October 2026 (CEST → CET): 17:00 UTC is 18:00 local.
    expect(isAmsterdamHour(18, new Date('2026-10-25T17:00:00Z'))).toBe(true)
    expect(isAmsterdamHour(18, new Date('2026-10-25T16:00:00Z'))).toBe(false)
  })

  it('fires exactly once on the 25-hour day', () => {
    // The autumn switch repeats 02:00–03:00 local. An hourly gate on
    // hour 18 is unaffected, but the tag is what guarantees "once" in
    // general — assert both halves of the doubled hour map to the same
    // date, so a reminder scheduled in it cannot be sent twice.
    const firstPass = new Date('2026-10-25T00:30:00Z') // 02:30 CEST
    const secondPass = new Date('2026-10-25T01:30:00Z') // 02:30 CET
    expect(amsterdamHour(firstPass)).toBe(2)
    expect(amsterdamHour(secondPass)).toBe(2)
    expect(dedupTag('murajaahReminder', 'u1', 'child-1', amsterdamDate(firstPass))).toBe(
      dedupTag('murajaahReminder', 'u1', 'child-1', amsterdamDate(secondPass)),
    )
  })
})

describe('event coverage', () => {
  it('covers every notification the TAD Notification Spec lists', () => {
    const expected: NotificationEvent[] = [
      'absence',
      'newAssignment',
      'assignmentDueTomorrow',
      'jilidMilestone',
      'surahMemorized',
      'murajaahReminder',
      'reportReady',
      // Not in the Spec's own table — it comes from the Scheduler
      // table's Friday digest, which had no notification defined for it
      // because the copy it describes cannot go on a lock screen. ADR-016.
      'weeklyDigest',
    ]
    expect([...NOTIFICATION_EVENTS]).toEqual(expected)
  })
})
