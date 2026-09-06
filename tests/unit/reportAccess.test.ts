import { describe, expect, it } from 'vitest'
import { isReportAuthorized, resolveReportPdfPath } from '../../netlify/functions/lib/reportAccess'
import type { Caller, ServiceClient } from '../../netlify/functions/lib/callerAuth'

/**
 * Extracted from `report-pdf.mts` for the same reasoning
 * `publishFlow.ts`'s own docstring gives for its own extraction:
 * "split out purely so this ordering is testable."
 *
 * Two questions, kept separate on purpose because the defect was
 * conflating them — `isReportAuthorized` asks whether *this caller* may
 * see *this report row*; `resolveReportPdfPath` decides *which Storage
 * object* gets signed once they may. The bug was letting a tutor-
 * writable column answer the second question; a caller's own identity
 * answers it now, unconditionally of what the row's `pdf_path` says.
 */

function caller(role: Caller['role'], id = 'caller-1'): Caller {
  return { id, role, full_name: 'Test Caller' }
}

/**
 * The tutor branch queries `classes`; the parent branch queries
 * `student_guardians` for an active link (ADR-040). `classMatch` covers
 * both — the tutor teaches the class / the caller is an active guardian.
 */
function fakeAdmin(classMatch: boolean): ServiceClient {
  return {
    from: (table: string) => {
      if (table === 'classes') {
        return {
          select: () => ({
            eq: () => ({
              contains: () => ({
                maybeSingle: async () => ({
                  data: classMatch ? { id: 'class-1' } : null,
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'student_guardians') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: async () => ({
                    data: classMatch ? { student_id: 'student-1' } : null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  } as unknown as ServiceClient
}

describe('resolveReportPdfPath', () => {
  it('derives the path from the report\'s own identity, never from the stored pointer', () => {
    expect(
      resolveReportPdfPath({
        student_id: 'stu-1',
        academic_year: '2025/2026',
        pdf_path: 'stu-1/2025-2026.pdf',
      }),
    ).toBe('stu-1/2025-2026.pdf')
  })

  it('regression: a stored pdf_path naming another student is ignored — the derived path is still the caller\'s own', () => {
    expect(
      resolveReportPdfPath({
        student_id: 'stu-1',
        academic_year: '2025/2026',
        // What a malicious tutor UPDATE would have written before
        // migration 016's grant closed that write.
        pdf_path: 'stu-999-another-family/2025-2026.pdf',
      }),
    ).toBe('stu-1/2025-2026.pdf')
  })

  it('null pdf_path (no PDF generated yet) resolves to null, before any signing call is made', () => {
    expect(resolveReportPdfPath({ student_id: 'stu-1', academic_year: '2025/2026', pdf_path: null })).toBeNull()
  })
})

describe('isReportAuthorized — the access matrix report-pdf.mts restates from RLS', () => {
  const draft = { status: 'draft', student_id: 'student-1', user_id: 'student-1', class_id: 'class-1' }
  const published = { ...draft, status: 'published' }

  it('admin → any status, drafts included, with no class lookup', async () => {
    const admin = fakeAdmin(false) // would refuse if the tutor branch ran at all
    await expect(isReportAuthorized(admin, caller('admin'), draft)).resolves.toBe(true)
    await expect(isReportAuthorized(admin, caller('admin'), published)).resolves.toBe(true)
  })

  it('tutor of the class → any status, drafts included', async () => {
    const admin = fakeAdmin(true)
    await expect(isReportAuthorized(admin, caller('tutor'), draft)).resolves.toBe(true)
    await expect(isReportAuthorized(admin, caller('tutor'), published)).resolves.toBe(true)
  })

  it('tutor NOT of the class → refused, any status', async () => {
    const admin = fakeAdmin(false)
    await expect(isReportAuthorized(admin, caller('tutor'), draft)).resolves.toBe(false)
    await expect(isReportAuthorized(admin, caller('tutor'), published)).resolves.toBe(false)
  })

  it('tutor with no class_id on the report → refused without querying', async () => {
    const admin = fakeAdmin(true) // would wrongly pass if queried
    await expect(
      isReportAuthorized(admin, caller('tutor'), { ...draft, class_id: null }),
    ).resolves.toBe(false)
  })

  it('parent → own child (an active guardian link), published only', async () => {
    const admin = fakeAdmin(true) // caller holds an active student_guardians link
    await expect(isReportAuthorized(admin, caller('parent', 'guardian-1'), published)).resolves.toBe(true)
    // …but a draft is refused before the guardian lookup even runs.
    await expect(isReportAuthorized(admin, caller('parent', 'guardian-1'), draft)).resolves.toBe(false)
  })

  it('parent → a child they are not a guardian of, any status → refused', async () => {
    const admin = fakeAdmin(false) // no active link for this caller
    await expect(isReportAuthorized(admin, caller('parent', 'someone-else'), published)).resolves.toBe(false)
    await expect(isReportAuthorized(admin, caller('parent', 'someone-else'), draft)).resolves.toBe(false)
  })

  it('student (16+ self-login) → own record, published only', async () => {
    const admin = fakeAdmin(false)
    await expect(isReportAuthorized(admin, caller('student', 'student-1'), published)).resolves.toBe(true)
    await expect(isReportAuthorized(admin, caller('student', 'student-1'), draft)).resolves.toBe(false)
  })

  it('student → a different student’s record, any status → refused', async () => {
    const admin = fakeAdmin(false)
    await expect(isReportAuthorized(admin, caller('student', 'someone-else'), published)).resolves.toBe(false)
  })
})
