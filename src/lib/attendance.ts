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

export interface GroupRate {
  classId: string
  className: string
  rate: number
  sessions: number
}

/**
 * The attendance rate per group, plus the overall figure (PRD Feature 8
 * FR-003). A child can be in several groups, and a single combined rate
 * hides a child who attends one and skips the other — 90% in Kelas A and
 * 50% in Aqidah reads as a reassuring 70% otherwise. Groups are ordered
 * by name so the card does not reshuffle between visits.
 */
export function ratesByGroup(
  rows: readonly { classId: string; className: string; status: AttendanceStatus }[],
): { overall: number; groups: GroupRate[] } {
  const byGroup = new Map<string, { className: string; statuses: AttendanceStatus[] }>()
  for (const row of rows) {
    const entry = byGroup.get(row.classId) ?? { className: row.className, statuses: [] }
    entry.statuses.push(row.status)
    byGroup.set(row.classId, entry)
  }
  const groups = [...byGroup.entries()]
    .map(([classId, { className, statuses }]) => ({
      classId,
      className,
      rate: computeAttendanceRate(statuses),
      sessions: statuses.length,
    }))
    .sort((a, b) => a.className.localeCompare(b.className))
  return { overall: computeAttendanceRate(rows.map((r) => r.status)), groups }
}
