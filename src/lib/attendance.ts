import type { Database } from './database.types'

type AttendanceStatus = Database['public']['Enums']['attendance_status']

/**
 * Percentage of sessions where the student showed up, counting 'late' as
 * attended (they were physically present, just not on time) — only
 * 'absent' counts against the rate. Rounded to 1 decimal place.
 */
export function computeAttendanceRate(statuses: AttendanceStatus[]): number {
  if (statuses.length === 0) return 0
  const attended = statuses.filter((s) => s !== 'absent').length
  return Math.round((attended / statuses.length) * 1000) / 10
}
