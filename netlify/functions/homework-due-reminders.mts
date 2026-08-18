import type { Config } from '@netlify/functions'
import { notifyStudents, reportable, type NotificationContext } from './lib/notifyStudent'
import { HOURLY, scheduledHandler } from './lib/scheduled'
import { addDays } from '../../src/lib/murajaah'

/**
 * PRD Feature 2 **FR-005** — "homework due tomorrow", at 08:00
 * Europe/Amsterdam (TAD Scheduler table).
 *
 * Morning rather than evening, deliberately: the reminder is useful on
 * the day there is still a day left to act on it, and a notification
 * about tomorrow's deadline arriving at 20:00 tonight buys a family
 * nothing they can use before bedtime.
 *
 * ── Students already finished are skipped ───────────────────────────
 * `assignment_status.status` is the child's own record of where they
 * are (checklist §11). Telling a family their homework is due tomorrow
 * when they marked it done last week is the kind of notification that
 * teaches people the notifications are not worth reading. Only
 * `completed` counts as done — `partial` and `incomplete` are states a
 * deadline still matters for, and `pending` is the default a row gets
 * before anyone has touched it.
 *
 * ── One reminder per child, not per assignment ──────────────────────
 * Two subjects due the same day is one lock-screen line saying there is
 * homework due tomorrow; the list is in the app. This is the dedup tag
 * doing its job rather than a special case — every recipient/child/day
 * pair resolves to one tag — but the student ids are collapsed here so
 * the Function does not pay a push service to send a payload that would
 * only replace the previous one.
 *
 * The assignment title stays out of the payload (DPIA R6), same as
 * `notify-assignment`.
 */
export default scheduledHandler({
  hour: 8,
  run: async (client, today) => {
    const empty = { sent: 0, expired: 0, failed: 0 }
    const tomorrow = addDays(today, 1)

    const { data: assignments, error } = await client
      .from('assignments')
      .select('id, class_id, title')
      .eq('due_date', tomorrow)
    if (error) throw new Error(error.message)
    if (!assignments || assignments.length === 0) {
      return { ...empty, skipped: `nothing due on ${tomorrow}` }
    }

    const classIds = [...new Set(assignments.map((a) => a.class_id))]
    const { data: students, error: rosterError } = await client
      .from('students')
      .select('id, class_id')
      .in('class_id', classIds)
    if (rosterError) throw new Error(rosterError.message)
    if (!students || students.length === 0) {
      return { ...empty, skipped: 'no students enrolled in those classes' }
    }

    const assignmentIds = assignments.map((a) => a.id)
    const { data: statuses, error: statusError } = await client
      .from('assignment_status')
      .select('assignment_id, student_id, status')
      .in('assignment_id', assignmentIds)
      .eq('status', 'completed')
    if (statusError) throw new Error(statusError.message)

    const finished = new Set((statuses ?? []).map((s) => `${s.assignment_id}:${s.student_id}`))
    const rosterByClass = new Map<string, string[]>()
    for (const student of students) {
      // `students.class_id` is nullable — a child enrolled but not yet
      // placed in a class. They are in no class's roster, so they get no
      // homework and no reminder about it.
      if (!student.class_id) continue
      const roster = rosterByClass.get(student.class_id)
      if (roster) roster.push(student.id)
      else rosterByClass.set(student.class_id, [student.id])
    }

    // Per student, because one morning's run can owe different children
    // different assignments — and one child more than one.
    const dueTitles = new Map<string, string[]>()
    for (const assignment of assignments) {
      for (const studentId of rosterByClass.get(assignment.class_id) ?? []) {
        if (finished.has(`${assignment.id}:${studentId}`)) continue
        const titles = dueTitles.get(studentId)
        if (titles) titles.push(assignment.title)
        else dueTitles.set(studentId, [assignment.title])
      }
    }
    const due = new Set(dueTitles.keys())

    if (due.size === 0) {
      return { ...empty, skipped: 'every student has already completed tomorrow’s homework' }
    }

    return reportable(
      await notifyStudents(client, {
        studentIds: [...due],
        event: 'assignmentDueTomorrow',
        // The Spec addresses this one to "Parent + Student".
        audience: 'family',
        // Today, not the due date: the tag's date means "when was this
        // sent", and keying it on the deadline would let one morning's
        // reminder suppress the next.
        date: today,
        // The in-app line names the assignment. A child with more than
        // one due tomorrow gets a count instead — the alternative is
        // naming one of them and silently dropping the rest, which is
        // the sibling-collision mistake in a different costume.
        context: (studentId): NotificationContext => {
          const titles = dueTitles.get(studentId) ?? []
          return titles.length === 1 ? { title: titles[0] } : { count: titles.length }
        },
      }),
    )
  },
})

export const config: Config = { schedule: HOURLY }
