import { academicYearWindow, isValidAcademicYear } from '../../src/lib/reports'
import type { Database } from '../../src/lib/database.types'
import { authenticateCaller, jsonError, jsonOk } from './lib/callerAuth'
import { planDrafts, type DraftGroup } from './lib/draftPlan'
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

  const tutorByClass = new Map<string, string>()
  const groupsByStudent = new Map<string, DraftGroup[]>()
  for (const row of memberRows ?? []) {
    const cls = row.class
    if (!cls) continue
    const tutorId = (cls.tutor_ids ?? [])[0]
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

  if (candidates.length === 0) {
    return jsonOk({
      created_count: 0,
      skipped_existing: skippedExisting,
      skipped_no_tutor: plan.skipped_no_tutor,
    })
  }

  // ---- attendance stats snapshot for the academic year window --------
  const { start, end } = academicYearWindow(academicYear)
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

  return jsonOk({
    created_count: createdCount,
    skipped_existing: skippedExisting,
    skipped_no_tutor: plan.skipped_no_tutor,
  })
}
