import type { Config } from '@netlify/functions'
import { amsterdamDate } from './lib/notifications'
import { notifyStudents, reportable } from './lib/notifyStudent'
import { HOURLY, scheduledHandler } from './lib/scheduled'
import { weekStart } from '../../src/lib/murajaah'
import { fetchWeeklyActivity, hasActivity } from '../../src/lib/weeklySummary'

/**
 * The Friday 08:00 weekly digest (TAD Scheduler table).
 *
 * ── The digest is a pointer, not the digest ─────────────────────────
 * The Scheduler table describes this as a push carrying "attendance %,
 * new progress". It cannot: DPIA R6 allows a payload to carry the
 * child's first name and the event type, and a lock screen reading
 * "Ali: 40% attendance this week" is exactly the disclosure that rule
 * exists to prevent — visible to anyone holding the phone, and about
 * the one figure a family would least like read over their shoulder.
 *
 * So the notification says the summary is ready and the summary is on
 * the dashboard (`src/features/dashboard/WeeklySummary.tsx`), behind a
 * login, which is ADR-015(b)'s two-tier model applied to the one
 * remaining notification that had no in-app half. Building that card is
 * not incidental to this Function — without it the push would be an
 * invitation to look at nothing.
 *
 * ── A quiet week sends nothing ──────────────────────────────────────
 * `hasActivity` gates every family: no attendance recorded, no Yanbu'a
 * or Quran entry, no murajaah confirmation means there is nothing to
 * summarise, and a notification would be asking a family to go and look
 * at an empty card. School holidays are the normal case for this, and
 * they are several weeks a year.
 *
 * ── Parents only ────────────────────────────────────────────────────
 * The Scheduler table says "weekly summary push to parents", and unlike
 * the report or new homework there is nothing here for a 16+ student to
 * act on — it is the summary a parent would otherwise have to go
 * looking for.
 */
export default scheduledHandler({
  hour: 8,
  onWeekday: 5, // Friday, in Amsterdam
  run: async (client, today) => {
    const empty = { sent: 0, expired: 0, failed: 0 }

    const { data: students, error } = await client.from('students').select('id')
    if (error) throw new Error(error.message)
    if (!students || students.length === 0) return { ...empty, skipped: 'no students' }

    const activity = await fetchWeeklyActivity(
      client,
      students.map((s) => s.id),
      { from: weekStart(today), to: today, toLocalDate: (iso) => amsterdamDate(new Date(iso)) },
    )

    const worthSending = [...activity.entries()]
      .filter(([, week]) => hasActivity(week))
      .map(([studentId]) => studentId)

    if (worthSending.length === 0) {
      return { ...empty, skipped: 'no activity to summarise this week' }
    }

    return reportable(
      await notifyStudents(client, {
        studentIds: worthSending,
        event: 'weeklyDigest',
        audience: 'parent',
        date: today,
      }),
    )
  },
})

export const config: Config = { schedule: HOURLY }
