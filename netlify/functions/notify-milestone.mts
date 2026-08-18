import { isJilidComplete, type JilidRef } from '../../src/lib/yanbua'
import { jsonError, jsonOk } from './lib/callerAuth'
import { amsterdamDate } from './lib/notifications'
import { notifyStudent, reportable } from './lib/notifyStudent'
import { serviceClient, verifyWebhookSecret } from './lib/webhookAuth'

/**
 * The two celebration notifications in the TAD's Notification Spec:
 * **jilid completed** (PRD Feature 3 FR-006) and **surah memorized**
 * (Feature 5 FR-005). One Function rather than two, because they differ
 * only in which table the webhook came from — the recipient derivation,
 * the payload rules and the dedup are identical.
 *
 * ── Where the milestone rules live ─────────────────────────────────
 * `isJilidComplete` is **imported from `src/lib/yanbua.ts`**, the same
 * module the Yanbu'a screen uses, rather than restated here. That rule
 * ("last page of the jilid *and* mastery is lancar") is a piece of
 * curriculum policy, and a second copy of it would drift the day
 * somebody decides `kurang_lancar` on the last page should count. The
 * project already imports `src/lib/reports.ts` into
 * `netlify/functions/` for the same reason.
 *
 * Surah memorization needs no such rule: it is already an explicit
 * tutor action — "Tandai Sudah Hafal" flips
 * `murajaah_assignments.active` to false (checklist §13, which resolved
 * FR-005 that way rather than adding an assessment column). The webhook
 * fires on exactly that transition, so the celebration follows the
 * tutor's own judgement rather than inferring one.
 *
 * ── Authorization ──────────────────────────────────────────────────
 * Same shape as `notify-absence`: the channel is authenticated with the
 * shared secret, the row is re-read from the database rather than
 * trusted from the body, and the recipient comes from the student's own
 * row via `notifyStudent`.
 */
interface WebhookBody {
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

  const rowId = body.record?.id
  if (!rowId) return jsonError('record.id is required', 400)

  if (body.table === 'yanbua_progress') return jilidMilestone(client, rowId)
  if (body.table === 'murajaah_assignments') return surahMemorized(client, rowId)
  return jsonError('Unsupported table for a milestone notification', 400)
}

type Client = Extract<ReturnType<typeof serviceClient>, { client: unknown }>['client']

async function jilidMilestone(client: Client, rowId: string) {
  const { data: row, error } = await client
    .from('yanbua_progress')
    .select('id, student_id, jilid, page, mastery, recorded_at')
    .eq('id', rowId)
    .maybeSingle()
  if (error) return jsonError(error.message, 500)
  if (!row) return jsonOk({ sent: 0, skipped: 'no such progress row' })

  // The page counts are reference data (migration 004), so the rule is
  // evaluated against the same table the UI reads rather than against a
  // number copied into this Function.
  const { data: jilidRefs, error: refError } = await client
    .from('yanbua_jilid')
    .select('jilid, page_count')
  if (refError) return jsonError(refError.message, 500)

  if (!isJilidComplete(row.jilid, row.page, row.mastery, (jilidRefs ?? []) as JilidRef[])) {
    // The common case by far: most progress entries are mid-jilid, or
    // are a last page that still needs repeating.
    return jsonOk({ sent: 0, skipped: 'not a jilid completion' })
  }

  const result = await notifyStudent(client, {
    studentId: row.student_id,
    event: 'jilidMilestone',
    audience: 'parent',
    date: amsterdamDate(new Date(row.recorded_at)),
    // In-app only. The lock screen says a jilid was finished; the
    // notification centre says *which* one, which is the celebration
    // the Notification Spec drafted and DPIA R6 keeps off a lock
    // screen rather than deletes (ADR-015(b), ADR-017).
    context: { number: row.jilid },
  })

  if (result.failed > 0) return jsonError('Push delivery failed', 502)
  return jsonOk(reportable(result))
}

async function surahMemorized(client: Client, rowId: string) {
  const { data: row, error } = await client
    .from('murajaah_assignments')
    .select('id, student_id, active, surah_num')
    .eq('id', rowId)
    .maybeSingle()
  if (error) return jsonError(error.message, 500)
  if (!row) return jsonOk({ sent: 0, skipped: 'no such assignment' })

  // Re-checked here as well as in the trigger: the row is re-read, so it
  // may have been reactivated between the write and this call.
  if (row.active) return jsonOk({ sent: 0, skipped: 'assignment is still active' })

  // Read from the reference table rather than transliterated here, so
  // the notification centre names the surah exactly as every other
  // screen does.
  const { data: surah } = await client
    .from('surahs')
    .select('transliteration')
    .eq('surah_num', row.surah_num)
    .maybeSingle()

  const result = await notifyStudent(client, {
    studentId: row.student_id,
    event: 'surahMemorized',
    audience: 'parent',
    date: amsterdamDate(),
    context: surah ? { surah: surah.transliteration } : {},
  })

  if (result.failed > 0) return jsonError('Push delivery failed', 502)
  return jsonOk(reportable(result))
}
