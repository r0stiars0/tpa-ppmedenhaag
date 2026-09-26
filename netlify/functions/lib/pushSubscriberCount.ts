import type { ServiceClient } from './callerAuth'
import { weekStart } from '../../../src/lib/murajaah'

export type PushSubscriberCountResult = { subscribers: number } | { subscriberCountError: string }

/**
 * Records this week's number of push-subscribed family recipients — the
 * baseline for the push opt-out guardrail (PRD Feature 8 KPI 10, TAD
 * ADR-045, migration 025).
 *
 * The count is computed in the database (`fn_record_push_subscriber_count`,
 * service_role only) so the definition of "family recipient" lives next to
 * the tables it reads, and the upsert there makes a re-run for the same
 * week a correction rather than a second row.
 *
 * Keyed on the **Monday** of `today`'s week. The weekly digest calls this
 * on Fridays; keying on the Friday would still be one row per week, but
 * Monday is how every other week in this codebase is named (`weekStart`).
 *
 * Never throws. This is a metric, and a metric failing must never cost
 * families their weekly summary — so a failure is logged and returned in
 * the job's result, where it shows up in the Netlify log with the rest of
 * the run's numbers.
 */
export async function recordPushSubscriberCount(
  client: ServiceClient,
  today: string,
): Promise<PushSubscriberCountResult> {
  try {
    const { data, error } = await client.rpc('fn_record_push_subscriber_count', {
      p_week_start: weekStart(today),
    })
    if (error) throw new Error(error.message)
    return { subscribers: data as number }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('recording the weekly push-subscriber count failed', err)
    return { subscriberCountError: message }
  }
}
