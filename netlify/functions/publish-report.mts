import { authenticateCaller, jsonError, jsonOk } from './lib/callerAuth'
import { publishReportFlow } from './lib/publishFlow'
import { renderReportPdf } from './lib/reportPdf'

/**
 * FR-003 / FR-006 — publish a draft report, or regenerate the PDF of an
 * already-published one after a post-publish edit.
 *
 * Authorization: the report's **authoring tutor only**. This is narrower
 * than the RLS policy behind `year_end_reports` (which also grants admin
 * ALL) on purpose — publishing is what makes a report visible to a
 * family, an authoring act rather than an administrative one. ADR-014
 * turned admin into a full super admin over every other operational
 * table *and* over this one's content, and deliberately left this single
 * check exactly where ADR-013 put it. It also matches what the tutor can
 * actually do through PostgREST: the `yer_tutor_rw` policy's WITH CHECK
 * requires `tutor_id = auth.uid()`, so a co-tutor on the same class can
 * read a colleague's report but cannot edit it — and therefore should
 * not be able to publish it either.
 *
 * Consequence, handled in the UI rather than here: an admin can edit a
 * published report but cannot regenerate its PDF, so the stored object
 * goes stale until the authoring tutor re-publishes. `ReportEditor`
 * hides the publish button for admin and says whose re-publish the PDF
 * is waiting on.
 *
 * The status flip is the last step and only runs if the PDF rendered and
 * uploaded — see `publishFlow.ts` for the ordering and why it lives in
 * its own module.
 *
 * FR-007 (report-ready push notification) is deliberately NOT wired up
 * here: no push/notification infrastructure exists anywhere in this
 * project yet, same deferral as the absence push, homework due-date
 * reminders, the Quran milestone celebration and Murajaah's daily
 * reminder. The publish flow is otherwise complete without it.
 */
export default async (req: Request) => {
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)

  const auth = await authenticateCaller(req)
  if ('error' in auth) return auth.error
  const { caller, admin } = auth

  let body: { report_id?: string }
  try {
    body = (await req.json()) as { report_id?: string }
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const reportId = body.report_id?.trim() ?? ''
  if (!reportId) return jsonError('report_id is required', 400)

  const { data: report, error: reportError } = await admin
    .from('year_end_reports')
    // Kept as one string literal (not concatenated) so supabase-js can
    // infer the row type from it — a `+`-joined select widens to plain
    // `string` and every field access then fails to typecheck.
    .select('*, student:students(full_name, class:classes(name)), tutor:users!year_end_reports_tutor_id_fkey(full_name)')
    .eq('id', reportId)
    .maybeSingle()
  if (reportError) return jsonError(reportError.message, 500)
  if (!report) return jsonError('Report not found', 404)

  if (report.tutor_id !== caller.id) {
    return jsonError('Only the authoring tutor can publish this report', 403)
  }

  // A report with no tutor narrative is by definition unfinished (PRD
  // 6.8 AC-003; non-goal #4 — the narrative is always tutor-authored).
  // Grades stay optional: a student who hasn't started memorizing yet
  // shouldn't need a fabricated Murajaah grade to get their report.
  if (!report.narrative?.trim()) {
    return jsonError('Add a narrative before publishing this report', 400)
  }

  const student = report.student
  const tutor = report.tutor

  // Normalised through Date so a first publish (JS `toISOString()`) and a
  // re-publish (the value read back from Postgres as `+00:00`) hand the
  // client the same string for the same instant.
  const publishedAt = new Date(report.published_at ?? Date.now()).toISOString()

  try {
    const result = await publishReportFlow(
      {
        report_id: report.id,
        student_id: report.student_id,
        academic_year: report.academic_year,
        pdf: {
          student_name: student?.full_name ?? '—',
          class_name: student?.class?.name ?? null,
          academic_year: report.academic_year,
          tutor_name: tutor?.full_name ?? caller.full_name,
          published_date: publishedAt.slice(0, 10),
          attendance_present: report.attendance_present,
          attendance_absent: report.attendance_absent,
          attendance_late: report.attendance_late,
          attendance_rate: Number(report.attendance_rate),
          yanbua_grade: report.yanbua_grade,
          yanbua_notes: report.yanbua_notes,
          quran_grade: report.quran_grade,
          quran_notes: report.quran_notes,
          murajaah_grade: report.murajaah_grade,
          murajaah_notes: report.murajaah_notes,
          overall_grade: report.overall_grade,
          narrative: report.narrative,
        },
      },
      {
        renderPdf: (input) => renderReportPdf(input),
        uploadPdf: async (path, pdf) => {
          const { error } = await admin.storage.from('reports').upload(path, pdf, {
            contentType: 'application/pdf',
            // FR-006: one current version per report — overwrite the
            // existing object rather than creating a second one.
            upsert: true,
          })
          if (error) throw error
        },
        markPublished: async (path) => {
          const { error } = await admin
            .from('year_end_reports')
            .update({
              status: 'published',
              pdf_path: path,
              // Preserved across re-publishes: this is when the family
              // first got the report, not when it was last corrected.
              // `updated_at` (touch trigger) tracks the edits.
              published_at: publishedAt,
            })
            .eq('id', report.id)
          if (error) throw error
          return { published_at: publishedAt }
        },
      },
    )

    return jsonOk(result)
  } catch (err) {
    // Nothing was committed — status is untouched, so a retry is safe.
    const message = err instanceof Error ? err.message : String(err)
    return jsonError(`PDF generation failed, report not published: ${message}`, 500)
  }
}
