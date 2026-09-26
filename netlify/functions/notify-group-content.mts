import { jsonError, jsonOk, type ServiceClient } from './lib/callerAuth'
import { groupContentNotice } from './lib/groupContent'
import { notifyStudents, reportable } from './lib/notifyStudent'
import { serviceClient, verifyWebhookSecret } from './lib/webhookAuth'

/**
 * A new announcement or course material in a group (PRD Feature 8
 * FR-004/FR-005, TAD ADR-045(g)). Called by the database webhooks on
 * INSERT into `group_announcements` and `group_materials` (migration
 * 028); an edit fires nothing, so it notifies nobody.
 *
 * Families only: the guardians of each enrolled child and a 16+ student
 * with their own login, through `notifyStudents(..., audience: 'family')`.
 * Tutors are not notified; they see the content on the group page.
 *
 * The roster is read here from `class_members`, never taken from the
 * request, and only the row id arrives in the body. The push names the
 * child and the group; the title, body, file name and link stay out of
 * it (DPIA R6). An announcement's title goes into the in-app row only.
 */
interface WebhookBody {
  table?: string
  record?: { id?: string }
}

type ContentTable = 'group_announcements' | 'group_materials'

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

  const table = body.table
  if (table !== 'group_announcements' && table !== 'group_materials') {
    return jsonError('table must be group_announcements or group_materials', 400)
  }
  const id = body.record?.id
  if (!id) return jsonError('record.id is required', 400)

  const { data: row, error } = await readRow(client, table, id)
  if (error) return jsonError(error.message, 500)
  if (!row) return jsonOk({ sent: 0, skipped: 'no such row' })

  const { data: members, error: rosterError } = await client
    .from('class_members')
    .select('student_id')
    .eq('class_id', row.class_id)
  if (rosterError) return jsonError(rosterError.message, 500)
  if (!members || members.length === 0) return jsonOk({ sent: 0, skipped: 'no students enrolled in this group' })

  const notice = groupContentNotice({
    table,
    id: row.id,
    classId: row.class_id,
    groupName: row.class?.name ?? '',
    title: row.title,
    createdAt: row.created_at,
  })

  const result = await notifyStudents(client, {
    studentIds: members.map((m) => m.student_id),
    event: notice.event,
    audience: 'family',
    date: notice.date,
    context: notice.context,
    refId: notice.refId,
    group: notice.group,
  })

  if (result.failed > 0) return jsonError('Push delivery failed', 502)
  return jsonOk(reportable(result))
}

function readRow(client: ServiceClient, table: ContentTable, id: string) {
  // Two literal selects rather than one built string, so supabase-js
  // infers each row type (a concatenated select widens to `string`).
  return table === 'group_announcements'
    ? client.from('group_announcements').select('id, class_id, title, created_at, class:classes(name)').eq('id', id).maybeSingle()
    : client.from('group_materials').select('id, class_id, title, created_at, class:classes(name)').eq('id', id).maybeSingle()
}
