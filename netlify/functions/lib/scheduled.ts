import { jsonError, jsonOk, type ServiceClient } from './callerAuth'
import { amsterdamDate, amsterdamHour, amsterdamWeekday, isAmsterdamHour } from './notifications'
import { serviceClient } from './webhookAuth'

/**
 * The shape every scheduled Function in this project shares, and the
 * three things they all have to get right.
 *
 * ── 1. Why they are hourly (TAD ADR-015(e), carried into ADR-016) ──
 * Netlify cron expressions are UTC-only. `0 17 * * *` is 18:00 in
 * Amsterdam for the winter and 19:00 for the whole of CEST, which
 * covers the entire TPA summer term. So every job here runs on
 * `0 * * * *` and asks `isAmsterdamHour(...)` whether this is its hour
 * in the family's timezone, resolving the offset from the runtime's
 * IANA database rather than by arithmetic. 23 of the 24 daily runs exit
 * here, before opening a database connection.
 *
 * The autumn switch repeats 02:00–03:00 local, so a job gated on an
 * hour in that window genuinely fires twice on one date. None of these
 * three is (18:00 and 08:00), but the dedup tag is keyed on the
 * family's local date regardless, so a second pass sends the same tag
 * and the browser replaces rather than stacks. Re-running is free by
 * construction, which is also what makes these safe to invoke by hand
 * during verification.
 *
 * ── 2. Why there is no shared secret ──
 * `notify-*` prove their channel with `verifyWebhookSecret`, because
 * Postgres can be told to send a header. Netlify's scheduler cannot:
 * it invokes the Function itself, with no way to attach one. Requiring
 * a secret here would mean the scheduler could never run the job, so
 * the control is different in kind, and it is defence in depth rather
 * than one check:
 *
 *   - Netlify documents a scheduled Function as **not reachable over
 *     HTTP** (`@netlify/functions`' own types say so on the `schedule`
 *     helper: "Not reachable via HTTP"). The platform is the boundary.
 *   - Nothing here reads the request. Not the body, not the query,
 *     not a header — `run` is not even given the `Request`. Every
 *     input comes from the database and the clock, so there is no
 *     parameter for a caller to influence even if one got through.
 *   - Every one of them is idempotent per family per local date (see
 *     above), so the worst a replay could do is send nothing.
 *
 * That last property is why this is acceptable and the same reasoning
 * would *not* transfer to a Function that wrote anything.
 *
 * ── 3. Why failures are reported, not thrown ──
 * A scheduled Function that throws is retried by the platform, and a
 * partial fan-out re-run is exactly the case the dedup tag already
 * covers. The handler returns the counts it achieved so a failure shows
 * up in the Netlify log with the numbers attached rather than as a
 * stack trace with no idea how far it got.
 */
export interface ScheduledJob<T> {
  /** Amsterdam local hour this job belongs to, 0–23. */
  hour: number
  /** Extra gate, e.g. Friday only. Given the Amsterdam weekday, 0 = Sunday. */
  onWeekday?: number
  /** `today` is the Amsterdam calendar date — the date the dedup tags are keyed on. */
  run: (client: ServiceClient, today: string) => Promise<T>
}

export function scheduledHandler<T>(job: ScheduledJob<T>): (req: Request) => Promise<Response> {
  return async () => {
    const now = new Date()

    if (!isAmsterdamHour(job.hour, now)) {
      return jsonOk({ skipped: `not ${job.hour}:00 in Europe/Amsterdam`, hour: amsterdamHour(now) })
    }
    if (job.onWeekday !== undefined && amsterdamWeekday(now) !== job.onWeekday) {
      return jsonOk({ skipped: 'not the scheduled weekday', weekday: amsterdamWeekday(now) })
    }

    const service = serviceClient()
    if ('error' in service) return service.error

    try {
      return jsonOk(await job.run(service.client, amsterdamDate(now)))
    } catch (err) {
      console.error('scheduled job failed', err)
      return jsonError(err instanceof Error ? err.message : 'Scheduled job failed', 500)
    }
  }
}

/** Hourly. The local-time gate above decides which of the 24 runs does anything. */
export const HOURLY = '0 * * * *'
