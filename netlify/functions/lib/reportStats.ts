import { computeAttendanceRate } from '../../../src/lib/attendance'
import type { Database } from '../../../src/lib/database.types'

type AttendanceStatus = Database['public']['Enums']['attendance_status']

export interface AttendanceStats {
  attendance_present: number
  attendance_absent: number
  attendance_late: number
  attendance_rate: number
}

/**
 * The attendance half of a draft report's stats snapshot (FR-001).
 *
 * Rate comes from the app's existing `computeAttendanceRate` rather than
 * a second formula here — 'late' counts as attended (the student showed
 * up, just not on time), only 'absent' counts against the rate. If that
 * definition ever changes, it changes in one place and the report agrees
 * with the attendance screens by construction.
 *
 * A student with no attendance rows in the year gets zeros and a 0 rate,
 * not a null — the snapshot columns are NOT NULL, and "no sessions
 * recorded" is honestly represented by 0/0/0 next to a 0% rate rather
 * than by a hidden absence of data.
 */
export function computeAttendanceStats(statuses: AttendanceStatus[]): AttendanceStats {
  return {
    attendance_present: statuses.filter((s) => s === 'present').length,
    attendance_absent: statuses.filter((s) => s === 'absent').length,
    attendance_late: statuses.filter((s) => s === 'late').length,
    attendance_rate: computeAttendanceRate(statuses),
  }
}
