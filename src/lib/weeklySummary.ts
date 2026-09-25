import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { addDays } from './murajaah'

/**
 * What a child did at the TPA this week, in one shape used by two
 * callers with different reasons to want it.
 *
 * The dashboard card renders it. `weekly-progress-digest` uses it to
 * decide whether there is anything worth a Friday notification at all —
 * a family whose child was ill all week should not be told to go and
 * look at an empty summary.
 *
 * They share this module rather than each running their own version of
 * the query, because if they disagreed the failure would be a family
 * opening a notification about a week that the screen then shows as
 * quiet, and the notification would be the thing they stopped trusting.
 *
 * Both clients are `SupabaseClient<Database>`: the screen's is the anon
 * client under RLS, so a parent sees only their own children whatever
 * ids are passed; the Function's is the service-role client, and every
 * student id it passes comes from the database rather than a request.
 */
export interface WeeklyActivity {
  /** Sessions this child was marked in — the denominator for the percentage. */
  recorded: number
  present: number
  absent: number
  late: number
  /** New Yanbu'a entries the tutor recorded. */
  yanbua: number
  /** New Quran recitation entries. */
  quran: number
  /** Home-practice confirmations the family logged. */
  murajaah: number
  /**
   * The attendance above, per group, ordered by name (PRD Feature 8
   * FR-003) — a child in two groups can attend one and skip the other,
   * which a single figure hides. Archived groups are not included.
   */
  groups: GroupWeek[]
}

export interface GroupWeek {
  classId: string
  className: string
  recorded: number
  present: number
  absent: number
  late: number
}

export const EMPTY_WEEK: WeeklyActivity = {
  recorded: 0,
  present: 0,
  absent: 0,
  late: 0,
  yanbua: 0,
  quran: 0,
  murajaah: 0,
  groups: [],
}

export function hasActivity(week: WeeklyActivity): boolean {
  return week.recorded > 0 || week.yanbua > 0 || week.quran > 0 || week.murajaah > 0
}

/**
 * Whole-number attendance percentage, or `null` when the child was not
 * marked in any session — which is not 0%, and must not be rendered as
 * one. A week with no TPA sessions in it (a holiday) would otherwise
 * report every child as having attended nothing.
 */
export function attendancePercent(week: Pick<WeeklyActivity, 'recorded' | 'present'>): number | null {
  if (week.recorded === 0) return null
  return Math.round((week.present / week.recorded) * 100)
}

export interface WeekWindow {
  /** Monday of the week, YYYY-MM-DD, in the family's timezone. */
  from: string
  /** Today, YYYY-MM-DD, in the family's timezone. */
  to: string
  /**
   * An ISO timestamp → that timezone's calendar date.
   *
   * `yanbua_progress` and `quran_progress` are stamped `recorded_at
   * timestamptz`, not a date, so "was this entry made this week" is a
   * question only the family's own timezone can answer: an entry made
   * at 00:30 on Monday in Amsterdam is 23:30 Sunday in UTC. Rather than
   * guess an offset in a range filter — the CET/CEST bug this whole
   * milestone keeps running into — the range is deliberately fetched a
   * day wide on each side and narrowed here. The Function passes
   * `amsterdamDate`; the browser passes its own local date.
   */
  toLocalDate: (iso: string) => string
}

function tally(
  counts: { recorded: number; present: number; absent: number; late: number },
  status: string,
): void {
  counts.recorded += 1
  if (status === 'present') counts.present += 1
  else if (status === 'absent') counts.absent += 1
  else if (status === 'late') counts.late += 1
}

export async function fetchWeeklyActivity(
  client: SupabaseClient<Database>,
  studentIds: string[],
  window: WeekWindow,
): Promise<Map<string, WeeklyActivity>> {
  const result = new Map<string, WeeklyActivity>()
  if (studentIds.length === 0) return result
  for (const id of studentIds) result.set(id, { ...EMPTY_WEEK, groups: [] })

  const { from, to, toLocalDate } = window
  const inWeek = (iso: string) => {
    const date = toLocalDate(iso)
    return date >= from && date <= to
  }

  // Attendance. Sessions first, so both queries are bounded by the week
  // rather than by a child's whole history.
  // An archived group runs nothing automatic (PRD Feature 8 FR-010), so
  // its sessions are left out of the week altogether.
  const { data: sessions } = await client
    .from('sessions')
    .select('id, class_id, class:classes(name, archived_at)')
    .gte('date', from)
    .lte('date', to)
  const liveSessions = (sessions ?? []).filter((s) => !s.class?.archived_at)
  const groupBySession = new Map(
    liveSessions.map((s) => [s.id, { classId: s.class_id, className: s.class?.name ?? '' }]),
  )
  const sessionIds = liveSessions.map((s) => s.id)
  if (sessionIds.length > 0) {
    const { data: attendance } = await client
      .from('attendance')
      .select('student_id, status, session_id')
      .in('session_id', sessionIds)
      .in('student_id', studentIds)
    for (const row of attendance ?? []) {
      const week = result.get(row.student_id)
      if (!week) continue
      tally(week, row.status)
      const group = groupBySession.get(row.session_id)
      if (!group?.classId) continue
      let groupWeek = week.groups.find((g) => g.classId === group.classId)
      if (!groupWeek) {
        groupWeek = { ...group, recorded: 0, present: 0, absent: 0, late: 0 }
        week.groups.push(groupWeek)
      }
      tally(groupWeek, row.status)
    }
    for (const week of result.values()) week.groups.sort((a, b) => a.className.localeCompare(b.className))
  }

  const wideFrom = `${addDays(from, -1)}T00:00:00Z`
  const wideTo = `${addDays(to, 2)}T00:00:00Z`

  const { data: yanbua } = await client
    .from('yanbua_progress')
    .select('student_id, recorded_at')
    .in('student_id', studentIds)
    .gte('recorded_at', wideFrom)
    .lt('recorded_at', wideTo)
  for (const row of yanbua ?? []) {
    const week = result.get(row.student_id)
    if (week && inWeek(row.recorded_at)) week.yanbua += 1
  }

  const { data: quran } = await client
    .from('quran_progress')
    .select('student_id, recorded_at')
    .in('student_id', studentIds)
    .gte('recorded_at', wideFrom)
    .lt('recorded_at', wideTo)
  for (const row of quran ?? []) {
    const week = result.get(row.student_id)
    if (week && inWeek(row.recorded_at)) week.quran += 1
  }

  // `murajaah_log.date` is a plain date, so it needs no narrowing —
  // but it is keyed on the assignment, not the student.
  const { data: assignments } = await client
    .from('murajaah_assignments')
    .select('id, student_id')
    .in('student_id', studentIds)
  const studentByAssignment = new Map((assignments ?? []).map((a) => [a.id, a.student_id]))
  if (studentByAssignment.size > 0) {
    const { data: logs } = await client
      .from('murajaah_log')
      .select('assignment_id')
      .in('assignment_id', [...studentByAssignment.keys()])
      .gte('date', from)
      .lte('date', to)
    for (const row of logs ?? []) {
      const week = result.get(studentByAssignment.get(row.assignment_id) ?? '')
      if (week) week.murajaah += 1
    }
  }

  return result
}
