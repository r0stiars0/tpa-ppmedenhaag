import type { ServiceClient } from './callerAuth'
import { buildPayload, type Locale, type NotificationEvent } from './notifications'
import {
  isValidSubscription,
  sendPush,
  type SendResult,
  type StoredSubscription,
} from './webPush'

/**
 * Who a notification about a given student goes to, and the one place
 * that decides it.
 *
 * Every notification in this system is *about a child*, so "who receives
 * it" is always answered from that child's row — `students.parent_id`,
 * and for a 16+ self-login student their own `students.user_id`. Nothing
 * about the recipient ever comes from the request that triggered the
 * notification, and since ADR-022 nothing about it comes from
 * `users.role` either: a person's relationship to *this* child is the
 * whole question, and a role column cannot express it.
 *
 * This lives in one module rather than per-Function on purpose. Sending
 * a family a notification about another family's child is the single
 * worst thing this product could do (test-plan §1: "a failure here is a
 * GDPR incident, not a bug"), and the way that happens in practice is
 * the fourth Function to need recipients writing its own slightly
 * different query. There is one query, here, and every sender uses it.
 */
export type Audience =
  /**
   * Parent only — the Notification Spec's default for attendance and
   * progress. A 16+ student does not need a push about their own
   * absence or their own jilid.
   */
  | 'parent'
  /**
   * Parent *and* the 16+ student themselves, where the Spec says
   * "Parent + Student": new homework, and a published year-end report.
   * Most of the TPA is under 16 and has no account, so for them this
   * resolves to the same single recipient as 'parent'.
   */
  | 'family'

export interface Recipient {
  userId: string
  locale: Locale
  /**
   * `null` when this recipient has no usable push subscription — they
   * declined notifications, their browser cannot do them, or a push
   * service invalidated the endpoint and a sender cleared it.
   *
   * They stay in the audience regardless, and that is the point: since
   * ADR-017 every recipient gets a row in the notification centre, and
   * the centre exists *for* the families who are not reachable by push.
   * Only `dispatch` filters on this.
   */
  subscription: StoredSubscription | null
}

export interface StudentAudience {
  studentId: string
  childFullName: string
  recipients: Recipient[]
}

/**
 * Resolves the audience for many students in two queries rather than two
 * per student — a new-homework notification fans out across a whole
 * class roster, and a per-student round trip would put the Function's
 * runtime at the mercy of class size.
 */
export interface StudentRow {
  id: string
  full_name: string
  parent_id: string
  user_id: string | null
}

/**
 * `role` is deliberately absent. It was read here until ADR-022, to skip
 * any user whose role was not `parent` or `student` — which is exactly
 * how a tutor whose own child attends the TPA was left hearing nothing
 * about their own child. It is not merely unused now: selecting it again
 * would put the column back within reach of a future gate, and the point
 * of ADR-022 is that this file has no business knowing what role anybody
 * holds.
 */
export interface UserRow {
  id: string
  locale: Locale
  push_sub: unknown
}

/**
 * The pairing itself, kept pure and separate from the two queries that
 * feed it — this is the logic that decides which account hears about
 * which child, so it is the piece that most needs to be testable
 * exhaustively rather than only through a live push.
 */
export function buildAudiences(
  students: StudentRow[],
  users: UserRow[],
  audience: Audience,
): StudentAudience[] {
  const reachable = new Map<string, Recipient>()
  for (const user of users) {
    // No filter on who these accounts *are*. There used to be one —
    // "skip any role that does not receive notifications" — and it was a
    // second, weaker answer to a question the two lines below already
    // answer exactly: an account reaches this map only by being named on
    // the child's own row, and a tutor is named on no row for the
    // children they teach. The role test could therefore only ever
    // subtract from a correct answer, which is what it did (ADR-022).
    //
    // A missing or malformed subscription no longer excludes anyone —
    // it only means this recipient is reached in the app rather than on
    // their lock screen (ADR-017).
    reachable.set(user.id, {
      userId: user.id,
      locale: user.locale,
      subscription: isValidSubscription(user.push_sub) ? user.push_sub : null,
    })
  }

  return students.map((student) => {
    const recipients: Recipient[] = []
    const parent = reachable.get(student.parent_id)
    if (parent) recipients.push(parent)
    if (audience === 'family' && student.user_id) {
      const self = reachable.get(student.user_id)
      // A 16+ student who is also their own parent contact would
      // otherwise be sent the same notification twice.
      if (self && self.userId !== student.parent_id) recipients.push(self)
    }
    return { studentId: student.id, childFullName: student.full_name, recipients }
  })
}

export async function audiencesForStudents(
  client: ServiceClient,
  studentIds: string[],
  audience: Audience,
): Promise<StudentAudience[]> {
  if (studentIds.length === 0) return []

  const { data: students, error } = await client
    .from('students')
    .select('id, full_name, parent_id, user_id')
    .in('id', studentIds)
  if (error || !students) return []

  const wanted = new Set<string>()
  for (const student of students) {
    wanted.add(student.parent_id)
    if (audience === 'family' && student.user_id) wanted.add(student.user_id)
  }

  const { data: users, error: usersError } = await client
    .from('users')
    .select('id, locale, push_sub')
    .in('id', [...wanted])
  if (usersError) return []

  return buildAudiences(students, users ?? [], audience)
}

export interface DispatchResult {
  sent: number
  /** Subscriptions the push service reported gone; cleared from `users.push_sub`. */
  expired: number
  failed: number
  tags: string[]
}

/**
 * Sends up to `CONCURRENCY` pushes at once.
 *
 * A class of 25 with a parent each is 25 sequential HTTPS round trips to
 * a push service — comfortably enough to reach a serverless function's
 * timeout on a slow day, and the failure mode would be "half the class's
 * parents were told about the homework". Bounded rather than unbounded
 * so a large class does not open a hundred sockets at once either.
 */
const CONCURRENCY = 10

async function pool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index]
      index += 1
      await worker(item)
    }
  })
  await Promise.all(runners)
}

/**
 * Builds and sends one payload per recipient — each in that recipient's
 * own locale, each with its own dedup tag — and clears any subscription
 * the push service reports as gone.
 *
 * A failure to one recipient never stops the others: two families, or a
 * parent and their 16+ child, are independent deliveries, and one dead
 * subscription must not cost anyone else their notification.
 */
export interface DispatchDeps {
  send: (subscription: StoredSubscription, payload: ReturnType<typeof buildPayload>) => Promise<SendResult>
  clearSubscription: (userId: string) => Promise<void>
}

export async function dispatch(
  client: ServiceClient,
  targets: StudentAudience[],
  event: NotificationEvent,
  date: string,
  // Injected the same way `publishReportFlow`'s are, and for the same
  // reason: the property that matters here — one dead subscription must
  // not cost anyone else their notification — cannot be produced on
  // demand against a real push service.
  deps: DispatchDeps = {
    send: sendPush,
    clearSubscription: async (userId) => {
      await client.from('users').update({ push_sub: null }).eq('id', userId)
    },
  },
): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, expired: 0, failed: 0, tags: [] }

  const deliveries = targets.flatMap((target) =>
    target.recipients
      // Everyone else already has their notification-centre row; a
      // recipient with no subscription is simply not reachable here.
      .filter((recipient) => recipient.subscription !== null)
      .map((recipient) => ({ target, recipient })),
  )

  await pool(deliveries, async ({ target, recipient }) => {
    const payload = buildPayload({
      event,
      locale: recipient.locale,
      childFullName: target.childFullName,
      recipientUserId: recipient.userId,
      studentId: target.studentId,
      date,
    })

    const outcome = await deps.send(recipient.subscription!, payload)

    if (outcome.status === 'sent') {
      result.sent += 1
      result.tags.push(payload.tag)
      return
    }

    if (outcome.status === 'gone') {
      result.expired += 1
      await deps.clearSubscription(recipient.userId)
      return
    }

    result.failed += 1
    console.error(`notify: push failed for ${event}`, outcome.statusCode, outcome.message)
  })

  return result
}

export interface NotifyResult extends DispatchResult {
  /**
   * Rows written to the notification centre — one per recipient,
   * whether or not they were also pushed to. `recorded` is therefore
   * normally *higher* than `sent`, and that difference is the feature
   * rather than a discrepancy (ADR-017).
   */
  recorded: number
  skipped?: string
}

/**
 * What a Function may put in its HTTP response.
 *
 * `DispatchResult.tags` is genuinely useful — it is how the tests and
 * the live harness prove a notification was addressed to the right
 * family — but a tag is `event:userId:studentId:date`, so returning it
 * hands the caller two internal identifiers per delivery. That is
 * personal data leaving through a channel that exists to report a
 * count, and for the scheduled Functions the caller is not necessarily
 * anyone: they carry no shared secret (see `lib/scheduled.ts`), and
 * under `netlify dev` they answer unauthenticated HTTP.
 *
 * Counts are not personal data and are what a Netlify log is read for,
 * so counts are what goes out. Anything needing the tags has the
 * `dispatch` return value in process. ADR-016.
 */
export function reportable(result: NotifyResult): Omit<NotifyResult, 'tags'> {
  const { tags: _tags, ...counts } = result
  return counts
}

/**
 * Everything the in-app copy interpolates beyond the child's name — the
 * jilid number, the surah, the assignment title and its due date.
 *
 * Scalars only, deliberately. This ends up in a `jsonb` column that a
 * screen renders, so the narrow type is what stops a sender from
 * casually posting a whole database row into it and quietly widening
 * what the notification centre stores about a child.
 *
 * The child's **name is not in here**: it is read through `student_id`,
 * so a corrected name corrects every past notification and the name is
 * not copied across hundreds of rows.
 */
export type NotificationContext = Record<string, string | number>

/** Per-student, because one homework run can name a different assignment per child. */
export type ContextInput = NotificationContext | ((studentId: string) => NotificationContext)

function contextFor(input: ContextInput | undefined, studentId: string): NotificationContext {
  if (!input) return {}
  return typeof input === 'function' ? input(studentId) : input
}

/**
 * Writes the notification-centre rows — one per (recipient, child) —
 * before anything is pushed.
 *
 * Order matters. The push is the unreliable half: it depends on a third
 * party, and `notify-absence` has already been seen clearing a
 * subscription a push service invalidated. Recording first means a
 * family's own record of what they were told never depends on whether
 * Google's push service was having a good minute.
 *
 * `on conflict do update` on (user, child, event, date) — the same
 * tuple as the dedup tag — is what makes an hourly scheduled Function
 * safe to re-run: the second pass refreshes the row rather than filling
 * a family's list with duplicates. It refreshes rather than ignores so
 * a corrected context (a re-titled assignment) is not stuck at its
 * first value.
 */
export async function recordNotifications(
  client: ServiceClient,
  targets: StudentAudience[],
  event: NotificationEvent,
  date: string,
  context?: ContextInput,
): Promise<number> {
  const rows = targets.flatMap((target) =>
    target.recipients.map((recipient) => ({
      user_id: recipient.userId,
      student_id: target.studentId,
      event,
      context: contextFor(context, target.studentId),
      event_date: date,
    })),
  )
  if (rows.length === 0) return 0

  const { error } = await client
    .from('notifications')
    .upsert(rows, { onConflict: 'user_id,student_id,event,event_date' })
  if (error) {
    // Never fatal to the send. A family losing the in-app copy of a
    // notification they still received on their phone is worse handled
    // by also withholding the push.
    console.error('notify: could not record notifications', error.message)
    return 0
  }
  return rows.length
}

/** The whole "notify these children's families" path. */
export interface NotifyArgs {
  studentIds: string[]
  event: NotificationEvent
  audience: Audience
  date: string
  context?: ContextInput
}

export async function notifyStudents(
  client: ServiceClient,
  args: NotifyArgs,
): Promise<NotifyResult> {
  const empty: DispatchResult = { sent: 0, expired: 0, failed: 0, tags: [] }

  const targets = await audiencesForStudents(client, args.studentIds, args.audience)
  if (targets.length === 0) return { ...empty, recorded: 0, skipped: 'no such student' }
  if (targets.every((t) => t.recipients.length === 0)) {
    // No account to tell at all — an unenrolled child, or a family whose
    // parent has no user row yet. Distinct from "nobody to *push* to".
    return { ...empty, recorded: 0, skipped: 'no recipient account' }
  }

  const recorded = await recordNotifications(client, targets, args.event, args.date, args.context)

  const reachable = targets.filter((t) => t.recipients.some((r) => r.subscription !== null))
  if (reachable.length === 0) {
    // Everyone was told in the app; nobody had push switched on. A
    // normal outcome, not a failure.
    return { ...empty, recorded, skipped: 'no push subscription' }
  }

  return { ...(await dispatch(client, targets, args.event, args.date)), recorded }
}

export function notifyStudent(
  client: ServiceClient,
  args: Omit<NotifyArgs, 'studentIds'> & { studentId: string },
): Promise<NotifyResult> {
  const { studentId, ...rest } = args
  return notifyStudents(client, { studentIds: [studentId], ...rest })
}
