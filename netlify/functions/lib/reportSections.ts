import type { Database } from '../../../src/lib/database.types'
import type { ReportGrade } from '../../../src/lib/reports'
import { computeAttendanceStats, type AttendanceStats } from './reportStats'

type AttendanceStatus = Database['public']['Enums']['attendance_status']
type ReportStatus = Database['public']['Enums']['report_status']

/**
 * Year-end report sections per group (PRD Feature 8 FR-008, TAD
 * ADR-045(h), Resolved Decisions 27 and 34). Pure, so the rules are
 * unit-testable without a database; `generate-year-end-drafts` and
 * `publish-report` supply the rows.
 */
export interface SectionGroup {
  name: string
  tracks_progress: boolean
  tutor_ids: readonly string[]
}

export interface PlannedSection extends AttendanceStats {
  report_id: string
  class_id: string
  tutor_id: string | null
}

/**
 * One section per group with tracking OFF that the student attended
 * during the academic year — at least one attendance record on its
 * sessions in the year window (`attendance` is already that window), or
 * a current membership. A child who left an Aqidah group in March keeps
 * its section. Only draft reports gain sections, and a re-run adds only
 * the missing ones (`existing` holds `report_id:class_id`).
 */
export function planSections(input: {
  reports: readonly { id: string; student_id: string; status: ReportStatus }[]
  groups: ReadonlyMap<string, SectionGroup>
  currentMemberships: ReadonlyMap<string, readonly string[]>
  attendance: readonly { student_id: string; class_id: string; status: AttendanceStatus }[]
  existing: ReadonlySet<string>
}): PlannedSection[] {
  const statuses = new Map<string, AttendanceStatus[]>()
  for (const row of input.attendance) {
    const key = `${row.student_id}:${row.class_id}`
    const list = statuses.get(key) ?? []
    list.push(row.status)
    statuses.set(key, list)
  }

  const rows: PlannedSection[] = []
  for (const report of input.reports) {
    if (report.status !== 'draft') continue
    const classIds = new Set<string>(input.currentMemberships.get(report.student_id) ?? [])
    for (const row of input.attendance) if (row.student_id === report.student_id) classIds.add(row.class_id)
    for (const classId of [...classIds].sort()) {
      const group = input.groups.get(classId)
      if (!group || group.tracks_progress) continue
      if (input.existing.has(`${report.id}:${classId}`)) continue
      rows.push({
        report_id: report.id,
        class_id: classId,
        tutor_id: group.tutor_ids[0] ?? null,
        ...computeAttendanceStats(statuses.get(`${report.student_id}:${classId}`) ?? []),
      })
    }
  }
  return rows
}

export function sectionComplete(section: { grade: ReportGrade | null; narrative: string | null }): boolean {
  return section.grade !== null && (section.narrative ?? '').trim().length > 0
}

export type PublishDecision<S> =
  | { ok: true; include: S[]; omitted: string[] }
  | { ok: false; status: 403 | 409; missing: string[] }

/**
 * Who may publish, and with which sections (Resolved Decision 34):
 * the report's author or an admin. Every section must have a grade and a
 * narrative; only an admin may publish with empty sections left out
 * (`omitEmpty`), for a tutor who cannot complete theirs.
 */
export function publishDecision<S extends { class_name: string; grade: ReportGrade | null; narrative: string | null }>(input: {
  isAuthor: boolean
  isAdmin: boolean
  sections: readonly S[]
  omitEmpty: boolean
}): PublishDecision<S> {
  if (!input.isAuthor && !input.isAdmin) return { ok: false, status: 403, missing: [] }
  const empty = input.sections.filter((s) => !sectionComplete(s))
  if (empty.length === 0) return { ok: true, include: [...input.sections], omitted: [] }
  if (input.isAdmin && input.omitEmpty) {
    return { ok: true, include: input.sections.filter(sectionComplete), omitted: empty.map((s) => s.class_name) }
  }
  return { ok: false, status: 409, missing: empty.map((s) => s.class_name) }
}
