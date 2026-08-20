import { reportPdfPath } from '../../../src/lib/reports'
import type { Caller, ServiceClient } from './callerAuth'

/**
 * Who may see a given `year_end_reports` row, and which Storage object
 * its PDF may be signed from — split out of `report-pdf.mts` for the
 * same reason `publishFlow.ts`'s own docstring gives for its own split:
 * so the ordering is testable. `report-pdf.mts` restates the RLS rules
 * in code (see its own docstring for why a signed URL needs its own
 * gate), and getting the two questions below tangled together is
 * exactly how the pre-migration-016 defect happened — the caller was
 * authorized to see the *row*, and the Function then trusted a *column
 * on that row* to say which object to sign.
 */

export interface ReportAccessInput {
  status: string
  parent_id: string
  user_id: string | null
  class_id: string | null
}

/**
 * Mirrors `year_end_reports` RLS:
 *   - admin  → any report, any status (drafts too) — `yer_admin_all`
 *   - tutor  → students in their own classes, any status — `yer_tutor_rw`
 *   - parent → own children, published only — `yer_parent_read`
 *   - student (16+ self-login) → own record, published only — `yer_student_read`
 */
export async function isReportAuthorized(
  admin: ServiceClient,
  caller: Caller,
  report: ReportAccessInput,
): Promise<boolean> {
  const published = report.status === 'published'

  switch (caller.role) {
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

export interface ReportPdfPointer {
  student_id: string
  academic_year: string
  pdf_path: string | null
}

/**
 * The Storage object to sign. `pdf_path` is consulted only
 * as the "has a PDF been generated yet?" flag: `null` means no PDF
 * exists (the caller gets the 404 branch before any signing call is
 * made), and any non-null value means one does, at the path this
 * function derives from the row's own identity. The stored string
 * itself is never read as the object name — a tutor holds (or once
 * held) `UPDATE` on `pdf_path`, so trusting it directly is what let a
 * repointed row sign another family's PDF. `reportPdfPath` is the same
 * deterministic function `publishFlow.ts` uses to compute the path it
 * actually uploads to, so derived equals stored for every legitimately
 * published report.
 */
export function resolveReportPdfPath(report: ReportPdfPointer): string | null {
  if (!report.pdf_path) return null
  return reportPdfPath(report.student_id, report.academic_year)
}
