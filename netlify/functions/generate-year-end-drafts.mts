import { academicYearWindow, isValidAcademicYear } from '../../src/lib/reports'
import type { Database } from '../../src/lib/database.types'
import { authenticateCaller, jsonError, jsonOk, type ServiceClient } from './lib/callerAuth'
import { planDrafts, type DraftGroup } from './lib/draftPlan'
import { planSections, type SectionGroup } from './lib/reportSections'
import { computeAttendanceStats } from './lib/reportStats'

type AttendanceStatus = Database['public']['Enums']['attendance_status']

/**
 * FR-001 — admin-triggered bulk creation of draft year-end reports.
 *
 * Admin-only, verified in-function against `public.users.role` (see
 * `authenticateCaller`), never trusted from the client — bulk-creating
 * one draft per enrolled student for a whole academic year needs an
 * enrollment-wide view, which only admin has.
 *
 * The response is still three counts and nothing else, but that is now
 * just the natural shape of a bulk job rather than a privacy boundary:
 * ADR-013 kept the response content-free because admin was not allowed
 * to see report content at all, and ADR-014 supersedes that — admin
 * reads and edits the drafts this creates, from the Reports screen the
 * generation panel now lives on.
 *
 * No `config.path` export — the default `/.netlify/functions/<name>`
 * route is what we want, and restating it breaks local `netlify dev`
 * routing (see README's Netlify Functions section).
 */
export default async (req: Request) => {
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)

  const auth = await authenticateCaller(req)
  if ('error' in auth) return auth.error
  const { caller, admin } = auth

  if (caller.role !== 'admin') return jsonError('Only admins can generate year-end drafts', 403)

  let body: { academic_year?: string; class_id?: string }
  try {
    body = (await req.json()) as { academic_year?: string; class_id?: string }
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const academicYear = body.academic_year?.trim() ?? ''
  const classId = body.class_id?.trim() || null

  if (!isValidAcademicYear(academicYear)) {
    return jsonError('academic_year must be two consecutive years, e.g. 2025/2026', 400)
  }

  // ---- who gets a report, and which tutor authors it -----------------
  // `year_end_reports.tutor_id` is NOT NULL, so a student who is in no
  // active group with a tutor simply cannot have a report generated for
  // them. Those are reported back as `skipped_no_tutor` rather than
  // silently dropped — it means someone has enrolment work to finish
  // before the reports are complete.
  //
  // A child can be in several groups (PRD Feature 8, ADR-045): the author
  // is chosen across all their ACTIVE groups by `defaultAuthor`, and the
  // optional class scope selects which students get a draft, not which
  // group's tutor authors it.
  if (classId) {
    const { data: scoped, error: scopedError } = await admin.from('classes').select('id').eq('id', classId)
    if (scopedError) return jsonError(scopedError.message, 500)
    if ((scoped ?? []).length === 0) return jsonError('Class not found', 404)
  }

  const { data: memberRows, error: membersError } = await admin
    .from('class_members')
    .select('student_id, class_id, class:classes!inner(name, tracks_progress, archived_at, tutor_ids)')
    .is('class.archived_at', null)
  if (membersError) return jsonError(membersError.message, 500)

  // A 16+ student assistant never becomes a report's author or a
  // section's writer: that name is printed on the family's PDF, and
  // assistants are not named to families (PRD Resolved Decision 33).
  const assistants = await fetchAssistantIds(admin)
  if ('error' in assistants) return jsonError(assistants.error, 500)

  const tutorByClass = new Map<string, string>()
  const groupsByStudent = new Map<string, DraftGroup[]>()
  for (const row of memberRows ?? []) {
    const cls = row.class
    if (!cls) continue
    const tutorId = (cls.tutor_ids ?? []).find((id) => !assistants.ids.has(id))
    if (tutorId) tutorByClass.set(row.class_id, tutorId)
    const groups = groupsByStudent.get(row.student_id) ?? []
    groups.push({ class_id: row.class_id, name: cls.name, tracks_progress: cls.tracks_progress })
    groupsByStudent.set(row.student_id, groups)
  }

  const studentQuery = admin.from('students').select('id')
  const { data: allStudents, error: studentsError } = await studentQuery
  if (studentsError) return jsonError(studentsError.message, 500)
  const students = (allStudents ?? [])
    .filter((s) => !classId || (groupsByStudent.get(s.id) ?? []).some((g) => g.class_id === classId))
    .map((s) => ({ id: s.id, groups: groupsByStudent.get(s.id) ?? [] }))

  // ---- skip students who already have a report for this year ---------
  const { data: existing, error: existingError } = await admin
    .from('year_end_reports')
    .select('student_id')
    .eq('academic_year', academicYear)
    .in(
      'student_id',
      (students ?? []).map((s) => s.id),
    )
  if (existingError) return jsonError(existingError.message, 500)

  const plan = planDrafts({
    students: students ?? [],
    tutorByClass,
    existingStudentIds: (existing ?? []).map((r) => r.student_id),
  })
  const { candidates } = plan
  let skippedExisting = plan.skipped_existing

  const { start, end } = academicYearWindow(academicYear)

  if (candidates.length === 0) {
    const sections = await addSections(admin, academicYear, students.map((s) => s.id), start, end)
    if ('error' in sections) return jsonError(sections.error, 500)
    return jsonOk({
      created_count: 0,
      skipped_existing: skippedExisting,
      skipped_no_tutor: plan.skipped_no_tutor,
      sections_created: sections.created,
    })
  }

  // ---- attendance stats snapshot for the academic year window --------
  const { data: attendance, error: attendanceError } = await admin
    .from('attendance')
    .select('student_id, status, sessions!inner(date)')
    .in(
      'student_id',
      candidates.map((s) => s.student_id),
    )
    .gte('sessions.date', start)
    .lte('sessions.date', end)
  if (attendanceError) return jsonError(attendanceError.message, 500)

  const statusesByStudent = new Map<string, AttendanceStatus[]>()
  for (const row of attendance ?? []) {
    const list = statusesByStudent.get(row.student_id) ?? []
    list.push(row.status)
    statusesByStudent.set(row.student_id, list)
  }

  const rows = candidates.map((candidate) => ({
    student_id: candidate.student_id,
    academic_year: academicYear,
    tutor_id: candidate.tutor_id,
    status: 'draft' as const,
    ...computeAttendanceStats(statusesByStudent.get(candidate.student_id) ?? []),
  }))

  // `ignoreDuplicates` makes a concurrent second trigger (a double-
  // clicked Generate button, two admins at once) a no-op for rows that
  // already landed instead of failing the whole batch on the
  // (student_id, academic_year) unique constraint. Only genuinely
  // inserted rows come back, so anything the pre-check missed still
  // gets counted as skipped rather than created.
  const { data: inserted, error: insertError } = await admin
    .from('year_end_reports')
    .upsert(rows, { onConflict: 'student_id,academic_year', ignoreDuplicates: true })
    .select('id')
  if (insertError) return jsonError(insertError.message, 500)

  const createdCount = (inserted ?? []).length
  skippedExisting += candidates.length - createdCount

  const sections = await addSections(admin, academicYear, students.map((s) => s.id), start, end)
  if ('error' in sections) return jsonError(sections.error, 500)

  return jsonOk({
    created_count: createdCount,
    skipped_existing: skippedExisting,
    skipped_no_tutor: plan.skipped_no_tutor,
    sections_created: sections.created,
  })
}

/**
 * PRD Feature 8 FR-008, TAD ADR-045(h): each DRAFT report of the year
 * gains a section per group with tracking off that the student attended
 * in the year or is in now. Runs on every generation, so a re-run adds
 * sections that are missing (a child who joined an Aqidah group after
 * the first run) and never touches existing or published ones.
 */
async function addSections(
  admin: ServiceClient,
  academicYear: string,
  studentIds: string[],
  start: string,
  end: string,
): Promise<{ created: number } | { error: string }> {
  if (studentIds.length === 0) return { created: 0 }
  const { data: reports, error: reportsError } = await admin
    .from('year_end_reports')
    .select('id, student_id, status')
    .eq('academic_year', academicYear)
    .eq('status', 'draft')
    .in('student_id', studentIds)
  if (reportsError) return { error: reportsError.message }
  if (!reports || reports.length === 0) return { created: 0 }
  const assistants = await fetchAssistantIds(admin)
  if ('error' in assistants) return { error: assistants.error }

  const reportStudentIds = reports.map((r) => r.student_id)
  const [classes, members, attendance, existing] = await Promise.all([
    // Archived groups too: a group the child attended may be archived by now.
    admin.from('classes').select('id, name, tracks_progress, tutor_ids'),
    admin
      .from('class_members')
      .select('student_id, class_id, class:classes!inner(archived_at)')
      .in('student_id', reportStudentIds)
      .is('class.archived_at', null),
    admin
      .from('attendance')
      .select('student_id, status, session:sessions!inner(class_id, date)')
      .in('student_id', reportStudentIds)
      .gte('session.date', start)
      .lte('session.date', end),
    admin.from('year_end_report_sections').select('report_id, class_id').in('report_id', reports.map((r) => r.id)),
  ])
  for (const result of [classes, members, attendance, existing]) if (result.error) return { error: result.error.message }

  const groups = new Map<string, SectionGroup>(
    (classes.data ?? []).map((c) => [
      c.id,
      { name: c.name, tracks_progress: c.tracks_progress, tutor_ids: (c.tutor_ids ?? []).filter((id) => !assistants.ids.has(id)) },
    ]),
  )
  const currentMemberships = new Map<string, string[]>()
  for (const m of members.data ?? []) {
    const list = currentMemberships.get(m.student_id) ?? []
    list.push(m.class_id)
    currentMemberships.set(m.student_id, list)
  }

  const rows = planSections({
    reports,
    groups,
    currentMemberships,
    attendance: (attendance.data ?? []).map((a) => ({ student_id: a.student_id, class_id: a.session.class_id, status: a.status })),
    existing: new Set((existing.data ?? []).map((e) => `${e.report_id}:${e.class_id}`)),
  })
  if (rows.length === 0) return { created: 0 }

  const { data: inserted, error } = await admin
    .from('year_end_report_sections')
    .upsert(rows, { onConflict: 'report_id,class_id', ignoreDuplicates: true })
    .select('id')
  if (error) return { error: error.message }
  return { created: (inserted ?? []).length }
}

/** Users who are also a student (16+ student assistants when they tutor). */
async function fetchAssistantIds(admin: ServiceClient): Promise<{ ids: Set<string> } | { error: string }> {
  const { data, error } = await admin.from('students').select('user_id').not('user_id', 'is', null)
  if (error) return { error: error.message }
  return { ids: new Set((data ?? []).map((s) => s.user_id as string)) }
}
