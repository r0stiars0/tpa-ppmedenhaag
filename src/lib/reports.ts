import type { Database } from './database.types'

export type ReportGrade = Database['public']['Enums']['report_grade']
export type ReportStatus = Database['public']['Enums']['report_status']

/**
 * Shared (client + Netlify Function) helpers for year-end reports.
 *
 * Deliberately dependency-free so `netlify/functions/` can import it
 * directly — same arrangement as `src/lib/attendance.ts`'s
 * `computeAttendanceRate`, which `generate-year-end-drafts` reuses so the
 * snapshotted `attendance_rate` and the rate the app shows elsewhere can
 * never drift apart.
 */

/** `YYYY/YYYY` with consecutive years, e.g. `2025/2026` (PRD open question #14). */
export const ACADEMIC_YEAR_RE = /^(\d{4})\/(\d{4})$/

export function isValidAcademicYear(value: string): boolean {
  const m = ACADEMIC_YEAR_RE.exec(value)
  if (!m) return false
  return Number(m[2]) === Number(m[1]) + 1
}

/**
 * Date window a given academic year covers, as inclusive `YYYY-MM-DD`
 * bounds. PPME's TPA year runs late Aug/early Sep to early/mid Jul
 * (PRD Open Question #14), so the window is deliberately wider than the
 * teaching period — 1 Aug through 31 Jul — rather than trying to pin
 * exact term dates that shift year to year. Any session in that window
 * belongs to the year; no session can fall between two windows.
 */
export function academicYearWindow(academicYear: string): { start: string; end: string } {
  const m = ACADEMIC_YEAR_RE.exec(academicYear)
  if (!m) throw new Error(`Invalid academic_year: ${academicYear} (expected YYYY/YYYY)`)
  return { start: `${m[1]}-08-01`, end: `${m[2]}-07-31` }
}

/**
 * The academic year a given date falls in. August onwards starts the new
 * year, matching `academicYearWindow`'s boundary — used to prefill the
 * admin generate form so the common case needs no typing.
 */
export function currentAcademicYear(date: Date = new Date()): string {
  const year = date.getFullYear()
  const startYear = date.getMonth() >= 7 ? year : year - 1
  return `${startYear}/${startYear + 1}`
}

/**
 * Storage object path for a report's PDF, inside the private `reports`
 * bucket. The TAD's stated convention is
 * `{student_id}/{academic_year}.pdf`, but `academic_year` contains a
 * slash — which Storage would read as a path separator, nesting every
 * report one directory deeper (`{student}/2025/2026.pdf`). The slash is
 * replaced with a hyphen so a report is one flat object per student per
 * year; the path stays deterministic, which is what makes republishing
 * overwrite in place rather than accumulate versions (FR-006).
 */
export function reportPdfPath(studentId: string, academicYear: string): string {
  return `${studentId}/${academicYear.replace('/', '-')}.pdf`
}

export const REPORT_GRADE_OPTIONS: ReportGrade[] = [
  'mumtaz',
  'jayyid_jiddan',
  'jayyid',
  'maqbul',
  'perlu_bimbingan',
]
