import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOURLY, scheduledHandler } from '../../netlify/functions/lib/scheduled'
import { amsterdamWeekday } from '../../netlify/functions/lib/notifications'

/**
 * The gate every scheduled Function shares (TAD ADR-015(e)/ADR-016).
 *
 * Netlify cron is UTC-only, so all three run hourly and decide for
 * themselves whether this is their hour in Europe/Amsterdam. 23 of the
 * 24 daily runs must exit before touching the database, and — the part
 * that would otherwise be wrong for seven months of the year — the hour
 * they do run in must be the same local hour on both sides of a DST
 * switch.
 *
 * 2026: CEST starts Sun 29 March, ends Sun 25 October.
 */
const REQUEST = new Request('https://example.invalid/.netlify/functions/x')

function at(iso: string) {
  vi.setSystemTime(new Date(iso))
}

describe('scheduledHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // `serviceClient()` only reads these; supabase-js opens no
    // connection until a query is issued, and no test here issues one.
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('refuses to run at all without service credentials', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const run = vi.fn()
    at('2026-01-15T17:00:00Z')
    const res = await scheduledHandler({ hour: 18, run })(REQUEST)
    expect(run).not.toHaveBeenCalled()
    expect(res.status).toBe(500)
  })

  it('runs at the target Amsterdam hour on a CET date', async () => {
    const run = vi.fn().mockResolvedValue({ sent: 1 })
    at('2026-01-15T17:00:00Z') // 18:00 CET
    const res = await scheduledHandler({ hour: 18, run })(REQUEST)
    expect(run).toHaveBeenCalledOnce()
    expect(await res.json()).toEqual({ sent: 1 })
  })

  it('runs at the same *local* hour on a CEST date, an hour earlier in UTC', async () => {
    // The bug the whole design exists to avoid: a fixed `0 17 * * *`
    // cron would fire here at 19:00 local, through the entire summer term.
    const run = vi.fn().mockResolvedValue({ sent: 1 })
    at('2026-06-15T16:00:00Z') // 18:00 CEST
    await scheduledHandler({ hour: 18, run })(REQUEST)
    expect(run).toHaveBeenCalledOnce()

    run.mockClear()
    at('2026-06-15T17:00:00Z') // 19:00 CEST — what the old cron would have hit
    await scheduledHandler({ hour: 18, run })(REQUEST)
    expect(run).not.toHaveBeenCalled()
  })

  it('exits without a database connection outside its hour', async () => {
    const run = vi.fn()
    at('2026-01-15T09:00:00Z') // 10:00 CET
    const res = await scheduledHandler({ hour: 18, run })(REQUEST)
    expect(run).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      skipped: 'not 18:00 in Europe/Amsterdam',
      hour: 10,
    })
  })

  it('holds the weekday gate to Amsterdam, not UTC', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true })
    // 23:30 UTC on Thursday 11 June 2026 is already 01:30 Friday in
    // Amsterdam. The digest is gated at 08:00, so this is the wrong
    // hour — but the weekday it resolves has to be Friday.
    at('2026-06-11T23:30:00Z')
    expect(amsterdamWeekday()).toBe(5)

    at('2026-06-12T06:00:00Z') // 08:00 CEST, Friday
    await scheduledHandler({ hour: 8, onWeekday: 5, run })(REQUEST)
    expect(run).toHaveBeenCalledOnce()
  })

  it('skips the right hour on the wrong day', async () => {
    const run = vi.fn()
    at('2026-06-11T06:00:00Z') // 08:00 CEST, Thursday
    const res = await scheduledHandler({ hour: 8, onWeekday: 5, run })(REQUEST)
    expect(run).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ skipped: 'not the scheduled weekday', weekday: 4 })
  })

  it('hands the job the Amsterdam date, which is what the dedup tags are keyed on', async () => {
    const run = vi.fn().mockResolvedValue({})
    // 22:15 UTC on 30 June is already 1 July in Amsterdam. A job keyed
    // on the UTC date would tag two consecutive evenings the same.
    at('2026-06-30T22:15:00Z')
    // 00:15 local is not hour 18, so use a job gated on the hour it is.
    await scheduledHandler({ hour: 0, run })(REQUEST)
    expect(run).toHaveBeenCalledWith(expect.anything(), '2026-07-01')
  })

  it('reports a failure with a 500 rather than throwing into a platform retry', async () => {
    const run = vi.fn().mockRejectedValue(new Error('Postgres said no'))
    at('2026-01-15T17:00:00Z')
    const res = await scheduledHandler({ hour: 18, run })(REQUEST)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Postgres said no' })
  })

  it('runs hourly, so the local-time gate is what decides', () => {
    expect(HOURLY).toBe('0 * * * *')
  })
})

describe('amsterdamWeekday', () => {
  it('is 0 for Sunday through 6 for Saturday', () => {
    expect(amsterdamWeekday(new Date('2026-08-16T12:00:00Z'))).toBe(0) // Sunday
    expect(amsterdamWeekday(new Date('2026-08-10T12:00:00Z'))).toBe(1) // Monday
    expect(amsterdamWeekday(new Date('2026-08-14T12:00:00Z'))).toBe(5) // Friday
    expect(amsterdamWeekday(new Date('2026-08-15T12:00:00Z'))).toBe(6) // Saturday
  })

  it('rolls over at Amsterdam midnight, not UTC midnight', () => {
    // 22:30 UTC Thursday = 00:30 CEST Friday.
    expect(amsterdamWeekday(new Date('2026-08-13T22:30:00Z'))).toBe(5)
    expect(amsterdamWeekday(new Date('2026-08-13T21:30:00Z'))).toBe(4)
  })
})
