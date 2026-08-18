import PDFDocument from 'pdfkit'
import type { ReportGrade } from '../../../src/lib/reports'
import { getHeaderLogoPng, HEADER_LOGO_ASPECT } from './logoAsset'

export interface ReportPdfInput {
  student_name: string
  class_name: string | null
  academic_year: string
  tutor_name: string
  published_date: string // YYYY-MM-DD
  attendance_present: number
  attendance_absent: number
  attendance_late: number
  attendance_rate: number
  yanbua_grade: ReportGrade | null
  yanbua_notes: string | null
  quran_grade: ReportGrade | null
  quran_notes: string | null
  murajaah_grade: ReportGrade | null
  murajaah_notes: string | null
  overall_grade: ReportGrade | null
  narrative: string | null
}

/** PPME brand palette (checklist §0 / ADR-007). */
const BRAND = {
  primary: '#0D50A0',
  primaryDark: '#0A3E7A',
  accent: '#C8A415',
  text: '#1F2933',
  muted: '#6B7280',
  rule: '#E5E7EB',
}

/**
 * Grade labels are bilingual, like every other label in this PDF — see
 * `renderReportPdf`'s note on why the document isn't rendered per-locale.
 * The four Arabic terms are untranslated in both locales (TAD "Other
 * Artifacts" → i18n), so only `perlu_bimbingan` actually differs.
 */
const GRADE_LABEL: Record<ReportGrade, string> = {
  mumtaz: 'Mumtaz',
  jayyid_jiddan: 'Jayyid Jiddan',
  jayyid: 'Jayyid',
  maqbul: 'Maqbul',
  perlu_bimbingan: 'Perlu Bimbingan / Begeleiding nodig',
}

const PAGE_MARGIN = 50

interface RenderOptions {
  /**
   * pdfkit compresses content streams (FlateDecode) by default, which
   * makes the output opaque to a plain text search. The PDF content
   * smoke test (test-plan.md §4.4) turns compression off so it can
   * assert on the literal strings; production always leaves it on.
   */
  compress?: boolean
  /**
   * Header logo override. Defaults to the inlined white wordmark
   * (`logoAsset.ts`). Pass `null` to force the typographic fallback, or a
   * deliberately broken Buffer, to exercise the "a publish must never
   * fail over branding" path — which is the only reason this is a
   * parameter rather than a plain import inside `drawHeader`.
   */
  logo?: Buffer | null
}

export function renderReportPdf(input: ReportPdfInput, options: RenderOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      compress: options.compress ?? true,
      info: {
        Title: `Rapor ${input.student_name} ${input.academic_year}`,
        Author: 'PPME Den Haag — TPA',
      },
    })

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    try {
      draw(doc, input, options.logo === undefined ? getHeaderLogoPng() : options.logo)
      doc.end()
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

function draw(doc: PDFKit.PDFDocument, input: ReportPdfInput, logo: Buffer | null): void {
  const left = PAGE_MARGIN
  const width = doc.page.width - PAGE_MARGIN * 2

  drawHeader(doc, left, logo)
  doc.y = 118

  // ---- title + student block ---------------------------------------
  doc
    .fillColor(BRAND.primaryDark)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('Rapor Akhir Tahun / Jaarrapport', left, doc.y)
  doc
    .fillColor(BRAND.muted)
    .font('Helvetica')
    .fontSize(11)
    .text(`Tahun Ajaran / Schooljaar ${input.academic_year}`, left, doc.y + 4)

  doc.moveDown(1)
  keyValue(doc, left, width, 'Nama Santri / Naam leerling', input.student_name)
  keyValue(doc, left, width, 'Grup / Groep', input.class_name ?? '—')

  // ---- attendance ---------------------------------------------------
  sectionTitle(doc, left, 'Ringkasan Kehadiran / Aanwezigheidsoverzicht')
  table(doc, left, width, [
    ['Hadir / Aanwezig', String(input.attendance_present)],
    ['Terlambat / Te laat', String(input.attendance_late)],
    ['Tidak hadir / Afwezig', String(input.attendance_absent)],
    ['Persentase kehadiran / Aanwezigheidspercentage', `${formatRate(input.attendance_rate)}%`],
  ])

  // ---- grades --------------------------------------------------------
  sectionTitle(doc, left, 'Nilai per Bidang / Cijfers per vak')
  table(doc, left, width, [
    ["Yanbu'a", gradeCell(input.yanbua_grade, input.yanbua_notes)],
    ['Al-Quran', gradeCell(input.quran_grade, input.quran_notes)],
    ['Murajaah', gradeCell(input.murajaah_grade, input.murajaah_notes)],
    ['Nilai Keseluruhan / Eindcijfer', gradeCell(input.overall_grade, null)],
  ])

  // ---- narrative ------------------------------------------------------
  sectionTitle(doc, left, 'Catatan Ustadz / Opmerking van de ustadz')
  doc
    .fillColor(BRAND.text)
    .font('Helvetica')
    .fontSize(10.5)
    .text(input.narrative?.trim() || '—', left, doc.y, { width, align: 'left', lineGap: 2 })

  // ---- footer ----------------------------------------------------------
  const footerY = doc.page.height - PAGE_MARGIN - 28
  doc
    .moveTo(left, footerY - 10)
    .lineTo(left + width, footerY - 10)
    .strokeColor(BRAND.rule)
    .lineWidth(1)
    .stroke()
  doc
    .fillColor(BRAND.muted)
    .font('Helvetica')
    .fontSize(9)
    .text(`Ustadz/Ustadzah: ${input.tutor_name}`, left, footerY, { width: width / 2 })
  doc.text(`Diterbitkan / Gepubliceerd: ${input.published_date}`, left + width / 2, footerY, {
    width: width / 2,
    align: 'right',
  })
}

/**
 * Brand header band: the reversed PPME wordmark on brand blue, with the
 * gold rule under it.
 *
 * The logo is the real bitmap now that a high-resolution master exists —
 * it used to be typeset because the only asset in the repo was 135x70px
 * (README "Known gaps"). The typographic version is still here as a
 * fallback: a report that publishes with a plainer header is a cosmetic
 * problem, a publish that fails because a logo would not decode is a
 * real one, so `doc.image()` is allowed to fail and fall through.
 */
function drawHeader(doc: PDFKit.PDFDocument, left: number, logo: Buffer | null): void {
  const BAND_HEIGHT = 84
  doc.rect(0, 0, doc.page.width, BAND_HEIGHT).fill(BRAND.primary)
  doc.rect(0, BAND_HEIGHT, doc.page.width, 4).fill(BRAND.accent)

  const LOGO_HEIGHT = 48
  let drewLogo = false
  if (logo) {
    try {
      doc.image(logo, left, (BAND_HEIGHT - LOGO_HEIGHT) / 2, { height: LOGO_HEIGHT })
      drewLogo = true
    } catch {
      drewLogo = false
    }
  }

  if (drewLogo) {
    const textLeft = left + LOGO_HEIGHT * HEADER_LOGO_ASPECT + 16
    doc
      .fillColor('#FFFFFF')
      .font('Helvetica')
      .fontSize(11)
      .text('TPA — Taman Pendidikan Al-Quran', textLeft, 36, {
        width: doc.page.width - textLeft - PAGE_MARGIN,
      })
    return
  }

  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text('PPME Den Haag', left, 26)
  doc.font('Helvetica').fontSize(10).text('TPA — Taman Pendidikan Al-Quran', left, 52)
}

function formatRate(rate: number): string {
  // numeric(5,2) comes back from PostgREST as a number like 92.31; trim a
  // trailing ".0" so a clean 100% doesn't read as "100.0%".
  return Number.isInteger(rate) ? String(rate) : String(Math.round(rate * 10) / 10)
}

function gradeCell(grade: ReportGrade | null, notes: string | null): string {
  const label = grade ? GRADE_LABEL[grade] : '—'
  const trimmed = notes?.trim()
  return trimmed ? `${label} — ${trimmed}` : label
}

function sectionTitle(doc: PDFKit.PDFDocument, left: number, text: string): void {
  doc.moveDown(1.2)
  doc.fillColor(BRAND.primary).font('Helvetica-Bold').fontSize(12).text(text, left, doc.y)
  doc.moveDown(0.4)
}

function keyValue(
  doc: PDFKit.PDFDocument,
  left: number,
  width: number,
  label: string,
  value: string,
): void {
  const y = doc.y
  doc.fillColor(BRAND.muted).font('Helvetica').fontSize(10).text(label, left, y, { width: width * 0.45 })
  doc
    .fillColor(BRAND.text)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(value, left + width * 0.45, y, { width: width * 0.55 })
  doc.moveDown(0.3)
}

/** Two-column table with zebra striping, sized to the text it holds. */
function table(doc: PDFKit.PDFDocument, left: number, width: number, rows: [string, string][]): void {
  const labelWidth = width * 0.45
  const valueWidth = width * 0.55 - 12

  rows.forEach(([label, value], i) => {
    const padding = 6
    const rowHeight =
      Math.max(
        doc.font('Helvetica').fontSize(10).heightOfString(label, { width: labelWidth - 12 }),
        doc.font('Helvetica-Bold').fontSize(10).heightOfString(value, { width: valueWidth }),
      ) +
      padding * 2

    const y = doc.y
    if (i % 2 === 0) doc.rect(left, y, width, rowHeight).fill('#F5F7FA')

    doc
      .fillColor(BRAND.muted)
      .font('Helvetica')
      .fontSize(10)
      .text(label, left + 6, y + padding, { width: labelWidth - 12 })
    doc
      .fillColor(BRAND.text)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(value, left + labelWidth, y + padding, { width: valueWidth })

    doc.y = y + rowHeight
  })
}
