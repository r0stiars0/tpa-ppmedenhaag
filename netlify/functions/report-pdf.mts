import { authenticateCaller, jsonError, jsonOk, type Caller, type ServiceClient } from './lib/callerAuth'

/** TAD "Supabase Storage" → recommended signed-URL TTL. */
const SIGNED_URL_TTL_SECONDS = 300

/**
 * FR-005 — mints a short-lived signed URL for a published report's PDF.
 *
 * The authorization check below is load-bearing in a way the rest of this
 * app's checks are not: a Supabase signed URL bypasses RLS completely,
 * and the `reports` bucket has no client-facing read policy at all
 * (migration 005), so this Function is the *only* gate between a caller
 * and the PDF. It therefore restates the `year_end_reports` RLS rules in
 * code rather than leaning on them:
 *
 *   - admin  → any report, any status (drafts too)
 *   - tutor  → students in their own classes, any status (drafts too)
 *   - parent → own children, published only
 *   - student (16+ self-login) → own record, published only
 *
 * Admin used to be denied here on application-layer grounds even though
 * RLS granted it ALL at the DB layer (ADR-012/ADR-013). ADR-014
 * supersedes both: admin is a super admin that reads and edits every
 * report, so refusing it the PDF of a report it can read in full in the
 * app was protecting nothing. What did *not* move is `publish-report`,
 * which still accepts the authoring tutor and nobody else — reading a
 * report and deciding a family may see it are different acts.
 */
export default async (req: Request) => {
  if (req.method !== 'GET') return jsonError('Method not allowed', 405)

  const auth = await authenticateCaller(req)
  if ('error' in auth) return auth.error
  const { caller, admin } = auth

  const reportId = new URL(req.url).searchParams.get('report_id')?.trim() ?? ''
  if (!reportId) return jsonError('report_id is required', 400)

  const { data: report, error: reportError } = await admin
    .from('year_end_reports')
    .select('id, student_id, status, pdf_path')
    .eq('id', reportId)
    .maybeSingle()
  if (reportError) return jsonError(reportError.message, 500)
  // Same response for "no such report" and "not yours": a caller who
  // isn't authorized shouldn't be able to tell the two apart.
  if (!report) return jsonError('Report not found', 404)

  const { data: student, error: studentError } = await admin
    .from('students')
    .select('id, parent_id, user_id, class_id')
    .eq('id', report.student_id)
    .maybeSingle()
  if (studentError) return jsonError(studentError.message, 500)
  if (!student) return jsonError('Report not found', 404)

  const allowed = await isAuthorized(admin, caller, {
    status: report.status,
    parent_id: student.parent_id,
    user_id: student.user_id,
    class_id: student.class_id,
  })
  if (!allowed) return jsonError('Not authorized to view this report', 403)

  if (!report.pdf_path) {
    return jsonError('No PDF has been generated for this report yet', 404)
  }

  const { data: signed, error: signError } = await admin.storage
    .from('reports')
    .createSignedUrl(report.pdf_path, SIGNED_URL_TTL_SECONDS)
  if (signError || !signed) {
    return jsonError(signError?.message ?? 'Could not create a download link', 500)
  }

  return jsonOk({ url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS })
}

async function isAuthorized(
  admin: ServiceClient,
  caller: Caller,
  report: {
    status: string
    parent_id: string
    user_id: string | null
    class_id: string | null
  },
): Promise<boolean> {
  const published = report.status === 'published'

  switch (caller.role) {
    // Mirrors `yer_admin_all`: every report, drafts included. Kept above
    // the tutor branch because it needs no class lookup at all.
    case 'admin':
      return true
    case 'tutor': {
      if (!report.class_id) return false
      const { data } = await admin
        .from('classes')
        .select('id')
        .eq('id', report.class_id)
        .contains('tutor_ids', [caller.id])
        .maybeSingle()
      return Boolean(data)
    }
    case 'parent':
      return published && report.parent_id === caller.id
    case 'student':
      return published && report.user_id === caller.id
    default:
      return false
  }
}
