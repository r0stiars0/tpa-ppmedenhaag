import { describe, expect, it, vi } from 'vitest'
import {
  academicYearWindow,
  currentAcademicYear,
  isValidAcademicYear,
  reportPdfPath,
} from '../../src/lib/reports'
import { planDrafts } from '../../netlify/functions/lib/draftPlan'
import { computeAttendanceStats } from '../../netlify/functions/lib/reportStats'
import { publishReportFlow, type PublishDeps } from '../../netlify/functions/lib/publishFlow'
import { renderReportPdf, type ReportPdfInput } from '../../netlify/functions/lib/reportPdf'

describe('academic year helpers', () => {
  it('accepts two consecutive years only', () => {
    expect(isValidAcademicYear('2025/2026')).toBe(true)
    expect(isValidAcademicYear('2025/2027')).toBe(false)
    expect(isValidAcademicYear('2025-2026')).toBe(false)
    expect(isValidAcademicYear('2025')).toBe(false)
  })

  it('spans 1 Aug through 31 Jul', () => {
    expect(academicYearWindow('2025/2026')).toEqual({ start: '2025-08-01', end: '2026-07-31' })
  })

  it('rolls over to the next academic year in August', () => {
    expect(currentAcademicYear(new Date('2026-07-31T12:00:00Z'))).toBe('2025/2026')
    expect(currentAcademicYear(new Date('2026-08-01T12:00:00Z'))).toBe('2026/2027')
  })

  it('keeps one flat Storage object per student per year', () => {
    // The slash in the academic year would otherwise nest the object a
    // directory deeper (`{student}/2025/2026.pdf`).
    expect(reportPdfPath('stu-1', '2025/2026')).toBe('stu-1/2025-2026.pdf')
  })
})

describe('computeAttendanceStats (test-plan §4.4 — stats accuracy)', () => {
  it('matches a hand-computed count and rate', () => {
    // 13 sessions: 10 present, 2 late, 1 absent → 12/13 attended = 92.3%
    const statuses = [
      ...Array<'present'>(10).fill('present'),
      ...Array<'late'>(2).fill('late'),
      'absent' as const,
    ]
    expect(computeAttendanceStats(statuses)).toEqual({
      attendance_present: 10,
      attendance_absent: 1,
      attendance_late: 2,
      attendance_rate: 92.3,
    })
  })

  it('reports zeros (not a null snapshot) for a student with no sessions', () => {
    expect(computeAttendanceStats([])).toEqual({
      attendance_present: 0,
      attendance_absent: 0,
      attendance_late: 0,
      attendance_rate: 0,
    })
  })
})

describe('planDrafts (test-plan §4.4 — duplicate generation)', () => {
  const tutorByClass = new Map([
    ['class-a', 'tutor-1'],
    ['class-b', 'tutor-2'],
  ])
  const students = [
    { id: 'stu-1', class_id: 'class-a' },
    { id: 'stu-2', class_id: 'class-a' },
    { id: 'stu-3', class_id: 'class-b' },
  ]

  it('creates one candidate per enrolled student on a first run', () => {
    const plan = planDrafts({ students, tutorByClass, existingStudentIds: [] })
    expect(plan.candidates).toEqual([
      { student_id: 'stu-1', tutor_id: 'tutor-1' },
      { student_id: 'stu-2', tutor_id: 'tutor-1' },
      { student_id: 'stu-3', tutor_id: 'tutor-2' },
    ])
    expect(plan.skipped_existing).toBe(0)
  })

  it('re-running skips everyone that already has a report, creating nothing', () => {
    const plan = planDrafts({
      students,
      tutorByClass,
      existingStudentIds: ['stu-1', 'stu-2', 'stu-3'],
    })
    expect(plan.candidates).toEqual([])
    expect(plan.skipped_existing).toBe(3)
  })

  it('counts a class with no tutor separately from an already-generated one', () => {
    const plan = planDrafts({
      students: [...students, { id: 'stu-4', class_id: 'class-c' }, { id: 'stu-5', class_id: null }],
      tutorByClass,
      existingStudentIds: ['stu-1'],
    })
    expect(plan.candidates.map((c) => c.student_id)).toEqual(['stu-2', 'stu-3'])
    expect(plan.skipped_existing).toBe(1)
    expect(plan.skipped_no_tutor).toBe(2)
  })
})

describe('publishReportFlow (test-plan §4.4 — publish atomicity)', () => {
  const input = {
    report_id: 'rep-1',
    student_id: 'stu-1',
    academic_year: '2025/2026',
    pdf: {} as ReportPdfInput,
  }

  function deps(overrides: Partial<PublishDeps> = {}): PublishDeps {
    return {
      renderPdf: vi.fn(async () => Buffer.from('%PDF-1.3')),
      uploadPdf: vi.fn(async () => undefined),
      markPublished: vi.fn(async () => ({ published_at: '2026-07-10T10:00:00.000Z' })),
      ...overrides,
    }
  }

  it('flips the status only after the PDF is rendered and stored', async () => {
    const d = deps()
    const result = await publishReportFlow(input, d)

    expect(d.renderPdf).toHaveBeenCalledOnce()
    expect(d.uploadPdf).toHaveBeenCalledWith('stu-1/2025-2026.pdf', expect.any(Buffer))
    expect(d.markPublished).toHaveBeenCalledWith('stu-1/2025-2026.pdf')
    expect(result).toEqual({
      report_id: 'rep-1',
      pdf_path: 'stu-1/2025-2026.pdf',
      published_at: '2026-07-10T10:00:00.000Z',
    })
  })

  it('leaves the report untouched when PDF generation fails', async () => {
    const d = deps({
      renderPdf: vi.fn(async () => {
        throw new Error('simulated pdfkit failure')
      }),
    })

    await expect(publishReportFlow(input, d)).rejects.toThrow('simulated pdfkit failure')
    // Neither the upload nor the status flip ran — the row is still a
    // draft, not a "published" report with no PDF behind it.
    expect(d.uploadPdf).not.toHaveBeenCalled()
    expect(d.markPublished).not.toHaveBeenCalled()
  })

  it('leaves the report untouched when the Storage upload fails', async () => {
    const d = deps({
      uploadPdf: vi.fn(async () => {
        throw new Error('simulated storage failure')
      }),
    })

    await expect(publishReportFlow(input, d)).rejects.toThrow('simulated storage failure')
    expect(d.markPublished).not.toHaveBeenCalled()
  })

  it('re-publishing overwrites the same object rather than creating a second one', async () => {
    const d = deps()
    const first = await publishReportFlow(input, d)
    const second = await publishReportFlow(input, d)

    expect(second.pdf_path).toBe(first.pdf_path)
    const paths = (d.uploadPdf as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])
    expect(new Set(paths).size).toBe(1)
  })
})

/**
 * Pulls the visible text back out of an uncompressed pdfkit document.
 *
 * pdfkit writes each line as a `TJ` array of hex-encoded runs split at
 * kerning pairs — `[<50504d45...> 10 <67> 0] TJ` — so a naive substring
 * search over the raw buffer finds nothing except the `/Info` metadata.
 * Decoding the hex runs of each array and joining them reconstructs one
 * string per rendered line, which is what the assertions below check.
 */
function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1')
  return [...raw.matchAll(/\[([^\]]*)\]\s*TJ/g)]
    .map((match) =>
      [...match[1].matchAll(/<([0-9a-fA-F]*)>/g)]
        .map((run) => Buffer.from(run[1], 'hex').toString('latin1'))
        .join(''),
    )
    .join('\n')
}

describe('renderReportPdf (test-plan §4.4 — PDF content smoke test)', () => {
  const input: ReportPdfInput = {
    student_name: 'Zainab Rahmawati',
    class_name: 'Grup A',
    academic_year: '2025/2026',
    tutor_name: 'Ustadz Ahmad',
    published_date: '2026-07-10',
    attendance_present: 10,
    attendance_absent: 1,
    attendance_late: 2,
    attendance_rate: 92.3,
    yanbua_grade: 'mumtaz',
    yanbua_notes: null,
    quran_grade: 'jayyid',
    quran_notes: null,
    murajaah_grade: 'maqbul',
    murajaah_notes: null,
    overall_grade: 'jayyid_jiddan',
    narrative: 'Alhamdulillah, perkembangan Zainab tahun ini sangat baik.',
  }

  it('contains the student name, year, attendance rate and all three subject grades', async () => {
    // Compression off so the content stream is searchable as plain text —
    // production leaves pdfkit's default FlateDecode on.
    const pdf = await renderReportPdf(input, { compress: false })
    expect(pdf.toString('latin1', 0, 5)).toBe('%PDF-')

    const text = extractPdfText(pdf)
    expect(text).toContain('Zainab Rahmawati')
    expect(text).toContain('2025/2026')
    expect(text).toContain('92.3%')
    expect(text).toContain('Mumtaz')
    expect(text).toContain('Jayyid')
    expect(text).toContain('Maqbul')
    expect(text).toContain('Ustadz Ahmad')
    expect(text).toContain('Alhamdulillah')
  })

  // The header logo is a real bitmap now (netlify/functions/lib/logoAsset.ts,
  // generated by scripts/generate-brand-assets.py). It is inlined as base64
  // rather than read from disk so `netlify dev` and deployed Netlify load
  // byte-identical bytes, but a corrupt or missing asset must still never
  // cost a family their report — hence the typographic fallback below.
  it('draws the bitmap wordmark in the header when the logo asset decodes', async () => {
    const pdf = await renderReportPdf(input, { compress: false })
    const text = extractPdfText(pdf)
    // Drawn, not typeset: the words only appear as glyphs in the fallback.
    expect(text).not.toContain('PPME Den Haag')
    expect(text).toContain('TPA')
  })

  it('falls back to the typographic wordmark when the logo asset is missing', async () => {
    const pdf = await renderReportPdf(input, { compress: false, logo: null })
    expect(extractPdfText(pdf)).toContain('PPME Den Haag')
  })

  it('falls back rather than throwing when the logo asset is corrupt', async () => {
    const pdf = await renderReportPdf(input, {
      compress: false,
      logo: Buffer.from('this is not a PNG'),
    })
    expect(pdf.toString('latin1', 0, 5)).toBe('%PDF-')
    expect(extractPdfText(pdf)).toContain('PPME Den Haag')
  })

  it('renders a report with no grades and no narrative without throwing', async () => {
    const bare = await renderReportPdf(
      {
        ...input,
        yanbua_grade: null,
        quran_grade: null,
        murajaah_grade: null,
        overall_grade: null,
        narrative: null,
        class_name: null,
      },
      { compress: false },
    )
    expect(bare.length).toBeGreaterThan(0)
  })
})
