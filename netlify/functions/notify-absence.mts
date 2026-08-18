import { jsonError, jsonOk } from './lib/callerAuth'
import { notifyStudent, reportable } from './lib/notifyStudent'
import { serviceClient, verifyWebhookSecret } from './lib/webhookAuth'

/**
 * PRD Feature 1 FR-005 / AC-002 — notify a parent when their child is
 * recorded absent.
 *
 * Triggered by a Supabase database webhook on `public.attendance`
 * (migration 009), not by the client that saved the attendance. That
 * choice matters: attendance is written from the tutor screen, the
 * admin screen (ADR-014) and potentially any future import, and a
 * webhook fires for all of them without each write path remembering to
 * ask. It also means a client that crashes mid-save cannot skip the
 * notification, and that a client cannot fire one at will.
 *
 * ── Authorization ──────────────────────────────────────────────────
 * There is no caller here, so `callerAuth.ts` does not apply — the
 * channel is authenticated with a shared secret instead
 * (`webhookAuth.ts`). Proving the channel is not the same as choosing
 * recipients, though, so two things are deliberately *not* trusted from
 * the request body:
 *
 *   - the row's contents: only `record.id` is used, and the attendance
 *     row is re-read from the database. A forged body therefore cannot
 *     invent an absence that did not happen.
 *   - the recipient: derived from `students.parent_id` for that row's
 *     student, never supplied. This is the single property that keeps a
 *     parent from being told about another family's child (test-plan §1:
 *     "a failure here is a GDPR incident, not a bug"), so it is
 *     computed from the database in exactly one place — `notifyStudent`,
 *     shared by every event-driven sender rather than restated here.
 *
 * ── Content ────────────────────────────────────────────────────────
 * The payload is built by `buildPayload`, which structurally cannot
 * carry the absence `reason` — a field that can hold health data (DPIA
 * R4/R6). The parent sees "[first name] was not present today" on the
 * lock screen and the reason only after signing in.
 */
interface WebhookBody {
  type?: string
  table?: string
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

  const attendanceId = body.record?.id
  if (!attendanceId) return jsonError('record.id is required', 400)

  const { data: row, error: rowError } = await client
    .from('attendance')
    // One string literal so supabase-js can infer the row type from it.
    .select('id, status, student_id, session:sessions(date)')
    .eq('id', attendanceId)
    .maybeSingle()
  if (rowError) return jsonError(rowError.message, 500)

  // Not an error: the row can be gone by the time the webhook lands, and
  // a re-saved roster fires for rows that are no longer absent.
  if (!row) return jsonOk({ sent: 0, skipped: 'no such attendance row' })
  if (row.status !== 'absent') return jsonOk({ sent: 0, skipped: 'not absent' })
  if (!row.session) return jsonOk({ sent: 0, skipped: 'incomplete row' })

  const result = await notifyStudent(client, {
    studentId: row.student_id,
    event: 'absence',
    // The Notification Spec addresses this one to the parent. A 16+
    // student does not need a push to tell them they were not there.
    audience: 'parent',
    // The session's own date, not "today": a correction entered the next
    // morning is still an absence for the day it happened, and the dedup
    // tag keys on that same date.
    date: row.session.date,
  })

  if (result.failed > 0) return jsonError('Push delivery failed', 502)
  return jsonOk(reportable(result))
}
