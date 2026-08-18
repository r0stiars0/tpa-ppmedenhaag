import { jsonError, jsonOk } from './lib/callerAuth'
import { amsterdamDate } from './lib/notifications'
import { notifyStudents, reportable } from './lib/notifyStudent'
import { serviceClient, verifyWebhookSecret } from './lib/webhookAuth'

/**
 * "New homework assigned" (TAD Notification Spec; PRD Feature 2's user
 * flow step 2). The first notification that fans out across a **class**
 * rather than concerning one child: one assignment reaches every
 * enrolled student in the class, and each of those reaches a parent and,
 * for a 16+ self-login student, the student too.
 *
 * Not one of the five Functions originally specced in checklist §4 —
 * that list predates the Notification Spec table having a "New homework
 * assigned" row with no Function against it. Added here rather than
 * folded into `notify-milestone`, which is about a single student's
 * achievement and shares none of the roster fan-out.
 *
 * The assignment **title is deliberately not in the payload** (DPIA R6):
 * the lock screen says there is new homework for the named child, and
 * the title is in the app. The builder could not carry it even if this
 * Function tried.
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

  const assignmentId = body.record?.id
  if (!assignmentId) return jsonError('record.id is required', 400)

  const { data: assignment, error } = await client
    .from('assignments')
    .select('id, class_id, created_at, title, due_date')
    .eq('id', assignmentId)
    .maybeSingle()
  if (error) return jsonError(error.message, 500)
  if (!assignment) return jsonOk({ sent: 0, skipped: 'no such assignment' })

  // The roster is read here, not taken from the request: a class's
  // membership is exactly who may be told about its homework.
  const { data: students, error: rosterError } = await client
    .from('students')
    .select('id')
    .eq('class_id', assignment.class_id)
  if (rosterError) return jsonError(rosterError.message, 500)
  if (!students || students.length === 0) {
    return jsonOk({ sent: 0, skipped: 'no students enrolled in this class' })
  }

  const result = await notifyStudents(client, {
    studentIds: students.map((s) => s.id),
    event: 'newAssignment',
    // The Spec addresses this one to "Parent + Student".
    audience: 'family',
    // The day the assignment was created, not its due date: the dedup
    // tag's date is "when did this happen", and using the due date would
    // collapse two assignments that happen to share a deadline while
    // splitting two created in the same sitting.
    date: amsterdamDate(new Date(assignment.created_at)),
    // The title and deadline the Spec's copy asked for, kept out of the
    // push payload (DPIA R6) and carried here for the in-app list.
    context: { title: assignment.title, date: assignment.due_date },
  })

  if (result.failed > 0) return jsonError('Push delivery failed', 502)
  return jsonOk(reportable(result))
}
