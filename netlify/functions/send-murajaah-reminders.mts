import type { Config } from '@netlify/functions'
import { amsterdamDate } from './lib/notifications'
import { notifyStudents, reportable } from './lib/notifyStudent'
import { HOURLY, scheduledHandler } from './lib/scheduled'
import { needsReminder, weekStart } from '../../src/lib/murajaah'

/**
 * PRD Feature 5 **FR-006** — the evening Murajaah reminder, at 18:00
 * Europe/Amsterdam (TAD Scheduler table).
 *
 * ── Who gets reminded, and when ─────────────────────────────────────
 * Not "everyone with an active target": that is a push every single
 * evening to every family, most of which say nothing they didn't
 * already know, and the predictable result is the notification being
 * switched off — after which the pipeline delivers nothing at all,
 * including the absence alerts that are the reason it exists.
 *
 * The rule is the one in `needsReminder` (`src/lib/murajaah.ts`):
 * remind a family on the last evening they can still meet the target's
 * frequency. `daily` is every evening practice hasn't been confirmed —
 * FR-006 as written. `3x_week` is the evening the days left in the week
 * drop to the confirmations still owed, so Friday if they have done
 * none and Sunday if they have done two. `weekly` is Sunday. A family
 * who is on track is not interrupted.
 *
 * That decision is a pure function tested per frequency, and this
 * Function does not restate any part of it: the same module answers the
 * streak on the family's screen, so the number the reminder is
 * protecting and the number the parent sees are the same number.
 *
 * ── Recipients ──────────────────────────────────────────────────────
 * Parents only (`audience: 'parent'`), per the Notification Spec's
 * "Daily Murajaah reminder | Parent" row. Confirming practice is a
 * parent action under RLS (`mlog_parent_insert` is scoped to
 * `confirmed_by = auth.uid()`), so a 16+ student cannot act on this
 * reminder even when it is their own memorization.
 *
 * The surah and ayah range the Spec's draft copy carried are not in the
 * payload — DPIA R6 — and `buildPayload` has no parameter that could
 * take them. Tapping through lands on `/murajaah`, where the target is.
 */
interface AssignmentRow {
  id: string
  student_id: string
  frequency: 'daily' | '3x_week' | 'weekly'
  created_at: string
}

export default scheduledHandler({
  hour: 18,
  run: async (client, today) => {
    const { data: assignments, error } = await client
      .from('murajaah_assignments')
      .select('id, student_id, frequency, created_at')
      .eq('active', true)
    if (error) throw new Error(error.message)
    if (!assignments || assignments.length === 0) {
      return { sent: 0, expired: 0, failed: 0, skipped: 'no active targets' }
    }

    // One query for every target's confirmations this week. That is all
    // `needsReminder` can look at — it only ever asks about the period
    // in progress — so there is no reason to read a family's history.
    const { data: logs, error: logError } = await client
      .from('murajaah_log')
      .select('assignment_id, date')
      .in(
        'assignment_id',
        assignments.map((a) => a.id),
      )
      .gte('date', weekStart(today))
    if (logError) throw new Error(logError.message)

    const datesByAssignment = new Map<string, string[]>()
    for (const log of logs ?? []) {
      const dates = datesByAssignment.get(log.assignment_id)
      if (dates) dates.push(log.date)
      else datesByAssignment.set(log.assignment_id, [log.date])
    }

    // A child with two targets due tonight is one reminder, not two:
    // the tag would collapse them on the lock screen anyway, and there
    // is no point paying a push service to find that out.
    const due = new Set<string>()
    for (const assignment of assignments as AssignmentRow[]) {
      const overdue = needsReminder({
        logDates: datesByAssignment.get(assignment.id) ?? [],
        frequency: assignment.frequency,
        today,
        // In the week a target was set, it asks for only as many
        // confirmations as there were days to give them.
        since: amsterdamDate(new Date(assignment.created_at)),
      })
      if (overdue) due.add(assignment.student_id)
    }

    if (due.size === 0) {
      return { sent: 0, expired: 0, failed: 0, skipped: 'every target is on track' }
    }

    return reportable(
      await notifyStudents(client, {
        studentIds: [...due],
        event: 'murajaahReminder',
        audience: 'parent',
        date: today,
      }),
    )
  },
})

export const config: Config = { schedule: HOURLY }
