import { jsonError, jsonOk } from './lib/callerAuth'
import { amsterdamDate } from './lib/notifications'
import { notifyStudent, reportable } from './lib/notifyStudent'
import { serviceClient, verifyWebhookSecret } from './lib/webhookAuth'

/**
 * PRD Feature 6 **FR-007** — the year-end report's "report ready" push,
 * deferred since Milestone 6 for want of this infrastructure.
 *
 * Driven by a webhook on `year_end_reports.status` reaching `published`,
 * **not** by a call inside `publish-report`. That is the same choice
 * migration 009 made for attendance, and it matters more here: the
 * publish flow's whole design (TAD ADR-011, PRD 6.4) is that a failure
 * anywhere must leave the report untouched rather than half-published,
 * and the ordering — render, upload, *then* flip the status — exists to
 * guarantee it. Adding a network call to a push service inside that flow
 * would put a family's notification in the same failure path as their
 * report. Out here, a push service having a bad minute cannot affect
 * whether the report published.
 *
 * ── Fires once, on the transition into published ───────────────────
 * A re-publish after a correction (FR-006) does **not** re-notify. Three
 * reasons, and the trigger in migration 010 enforces it rather than this
 * Function: re-publishing leaves `status` at `published` and preserves
 * the original `published_at`, so there is no second publish *event* to
 * report; the copy says the report is ready, which is true once and
 * stays true, because FR-006's model is a single current version behind
 * a stable link rather than a new document; and an admin may edit a
 * published report without regenerating the PDF at all (ADR-014(e)), so
 * a notification triggered by editing would announce "ready" for a file
 * that had not changed.
 */
interface WebhookBody {
  record?: { id?: string }
}

export default async (req: Request) => {
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)

  const unauthorized = verifyWebhookSecret(req)
  if (unauthorized) return unauthorized.error

  const service = serviceClient()
  if ('error' in service) return service.error
  const { client } = service

  let body: WebhookBody
  try {
    body = (await req.json()) as WebhookBody
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const reportId = body.record?.id
  if (!reportId) return jsonError('record.id is required', 400)

  const { data: report, error } = await client
    .from('year_end_reports')
    .select('id, student_id, status')
    .eq('id', reportId)
    .maybeSingle()
  if (error) return jsonError(error.message, 500)
  if (!report) return jsonOk({ sent: 0, skipped: 'no such report' })

  // Re-read rather than trusted: a report could have been reverted
  // between the write and this call.
  if (report.status !== 'published') return jsonOk({ sent: 0, skipped: 'report is not published' })

  const result = await notifyStudent(client, {
    studentId: report.student_id,
    event: 'reportReady',
    // The Spec addresses this one to "Parent + Student (16+)" — the one
    // notification a 16+ student most clearly has their own stake in,
    // since they can open the report themselves (ADR-014 / report-pdf).
    audience: 'family',
    date: amsterdamDate(),
  })

  if (result.failed > 0) return jsonError('Push delivery failed', 502)
  return jsonOk(reportable(result))
}
