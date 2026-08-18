import { reportPdfPath } from '../../../src/lib/reports'
import type { ReportPdfInput } from './reportPdf'

export interface PublishDeps {
  renderPdf: (input: ReportPdfInput) => Promise<Buffer>
  /** Must overwrite in place (upsert) — see the FR-006 note below. */
  uploadPdf: (path: string, pdf: Buffer) => Promise<void>
  /** The single, last write: flips status and records where the PDF landed. */
  markPublished: (path: string) => Promise<{ published_at: string }>
}

export interface PublishInput {
  report_id: string
  student_id: string
  academic_year: string
  pdf: ReportPdfInput
}

export interface PublishResult {
  report_id: string
  pdf_path: string
  published_at: string
}

/**
 * Publish (or re-publish) a year-end report, ordered so the status flip is
 * the *last* thing that happens (PRD 6.4 reliability, test-plan.md §4.4).
 *
 * render → upload → mark published. Anything that throws before
 * `markPublished` leaves the row exactly as it was — a draft stays a
 * draft, a published report keeps its previous `pdf_path` — so a failed
 * publish is always safe to retry and there is no intermediate state to
 * get stuck in. The reverse order (flip first, render after) is what
 * would produce a "published" report with no PDF behind it.
 *
 * `reportPdfPath` is deterministic per (student, academic year), so
 * re-publishing after a post-publish edit overwrites the same Storage
 * object instead of accumulating versions — FR-006's single-current-
 * version model, and why `uploadPdf` must upsert rather than insert.
 *
 * Split out from the Function handler purely so this ordering is
 * testable: the unit test injects a `renderPdf` that throws and asserts
 * `markPublished` was never reached.
 */
export async function publishReportFlow(
  input: PublishInput,
  deps: PublishDeps,
): Promise<PublishResult> {
  const path = reportPdfPath(input.student_id, input.academic_year)

  const pdf = await deps.renderPdf(input.pdf)
  await deps.uploadPdf(path, pdf)
  const { published_at } = await deps.markPublished(path)

  return { report_id: input.report_id, pdf_path: path, published_at }
}
