import type { Database } from './database.types'
import { computeAttendanceRate } from './attendance'

type AttendanceStatus = Database['public']['Enums']['attendance_status']

/**
 * What one mark on a strip means (TAD ADR-046(c)). The three recorded
 * statuses, plus the two the admin tutor overview needs: a session of a
 * group the tutor teaches was held but their row was never filled in,
 * and none of their groups met that day.
 */
export type Mark = AttendanceStatus | 'notRecorded' | 'noSession'

export interface SessionPoint {
  date: string
  attended: number
  total: number
  /** Whole percent, late counted as attended. */
  rate: number
}

/**
 * The group tile's data (ADR-046(a)): the last `n` sessions that have any
 * student attendance recorded, oldest-first, the latest one, and the
 * pooled rate over those `n`. A session the register opened but nobody
 * submitted yet has no statuses and is skipped — it is not a 0%.
 */
export function groupSessionSeries(
  sessions: readonly { date: string; statuses: AttendanceStatus[] }[],
  n = 8,
): { points: SessionPoint[]; latest: SessionPoint | null; average: number | null } {
  const points = sessions
    .filter((s) => s.statuses.length > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-n)
    .map((s) => {
      const attended = s.statuses.filter((st) => st !== 'absent').length
      return {
        date: s.date,
        attended,
        total: s.statuses.length,
        rate: Math.round((attended / s.statuses.length) * 100),
      }
    })
  if (points.length === 0) return { points, latest: null, average: null }
  const attended = points.reduce((sum, p) => sum + p.attended, 0)
  const total = points.reduce((sum, p) => sum + p.total, 0)
  return { points, latest: points[points.length - 1], average: Math.round((attended / total) * 100) }
}

/**
 * Percent values → SVG coordinates, 100% at the top. `pad` keeps the end
 * dot inside the viewBox. One point sits in the middle.
 */
export function sparklinePoints(
  values: readonly number[],
  width: number,
  height: number,
  pad: number,
): [number, number][] {
  const round = (v: number) => Math.round(v * 10) / 10
  return values.map((v, i) => {
    const x = values.length === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (values.length - 1)
    const y = pad + ((100 - Math.min(100, Math.max(0, v))) * (height - 2 * pad)) / 100
    return [round(x), round(y)]
  })
}

/** The latest `n` rows, oldest-first — a family strip reads left to right. */
export function lastMarks<T extends { date: string }>(rows: readonly T[], n = 8): T[] {
  return [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(-n)
}

const SEVERITY: Record<AttendanceStatus, number> = { present: 0, late: 1, absent: 2 }

/** Absent beats late beats present — for a tutor marked in two groups one day. */
export function worstStatus(statuses: readonly AttendanceStatus[]): AttendanceStatus {
  return statuses.reduce<AttendanceStatus>(
    (worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst),
    'present',
  )
}

export interface OverviewTutor {
  id: string
  name: string
  /** The groups in the filter this tutor teaches *today* (`tutor_ids`). */
  classIds: string[]
}

export interface OverviewSession {
  id: string
  classId: string
  date: string
  /** At least one student or tutor row recorded. */
  held: boolean
}

export interface OverviewRow {
  sessionId: string
  tutorId: string
  status: AttendanceStatus
  reason: string | null
}

export interface OverviewResult {
  columns: string[]
  tutors: {
    id: string
    name: string
    marks: Mark[]
    /** Over every recorded row in range; null when there is none. */
    rate: number | null
    counts: Record<AttendanceStatus, number>
  }[]
}

/**
 * Hadir › Guru (ADR-046(e)). The columns are the last `n` dates on which
 * any session in the input was held, shared by every row so a column is
 * one day. For each tutor and date: their recorded status (the worst, if
 * two groups met), else "not recorded" if a group they currently teach
 * held a session, else "no session". The rate covers all their rows in
 * the input, not just the visible columns.
 */
export function tutorOverview(input: {
  tutors: readonly OverviewTutor[]
  sessions: readonly OverviewSession[]
  rows: readonly OverviewRow[]
  n?: number
}): OverviewResult {
  const n = input.n ?? 8
  const sessionById = new Map(input.sessions.map((s) => [s.id, s]))
  const columns = [...new Set(input.sessions.filter((s) => s.held).map((s) => s.date))].sort().slice(-n)

  const tutors = input.tutors
    .map((tutor) => {
      const own = input.rows.filter((r) => r.tutorId === tutor.id && sessionById.has(r.sessionId))
      if (tutor.classIds.length === 0 && own.length === 0) return null
      const taught = new Set(tutor.classIds)
      const marks: Mark[] = columns.map((date) => {
        const recorded = own.filter((r) => sessionById.get(r.sessionId)!.date === date).map((r) => r.status)
        if (recorded.length > 0) return worstStatus(recorded)
        const heldHere = input.sessions.some((s) => s.held && s.date === date && taught.has(s.classId))
        return heldHere ? 'notRecorded' : 'noSession'
      })
      const statuses = own.map((r) => r.status)
      return {
        id: tutor.id,
        name: tutor.name,
        marks,
        rate: statuses.length === 0 ? null : computeAttendanceRate(statuses),
        counts: {
          present: statuses.filter((s) => s === 'present').length,
          late: statuses.filter((s) => s === 'late').length,
          absent: statuses.filter((s) => s === 'absent').length,
        },
      }
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .sort((a, b) => a.name.localeCompare(b.name))

  return { columns, tutors }
}

/**
 * Who gets a row in Hadir › Guru: every tutor `fn_class_tutors` lists for
 * a group in the filter (so a student-assistant stays off, ADR-041(e)),
 * with the filtered groups they teach, plus anyone with a recorded row in
 * range who no longer teaches one of them (`names`), with no groups.
 */
export function overviewTutors(input: {
  classIds: readonly string[]
  tutorsByClass: Readonly<Record<string, readonly { user_id: string; full_name: string }[]>>
  names: Readonly<Record<string, string>>
}): OverviewTutor[] {
  const byId = new Map<string, OverviewTutor>()
  for (const classId of input.classIds) {
    for (const tutor of input.tutorsByClass[classId] ?? []) {
      const entry = byId.get(tutor.user_id) ?? { id: tutor.user_id, name: tutor.full_name, classIds: [] }
      entry.classIds.push(classId)
      byId.set(tutor.user_id, entry)
    }
  }
  for (const [id, name] of Object.entries(input.names)) {
    if (!byId.has(id)) byId.set(id, { id, name, classIds: [] })
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}
