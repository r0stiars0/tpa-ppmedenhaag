import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The two ends of a send that the existing suites reach past.
 *
 * `notifyStudent.test.ts` covers the pairing (`buildAudiences`) and the
 * fan-out (`dispatch`, `recordNotifications`) directly. Between them sits
 * `notifyStudents`, which every one of the six senders actually calls,
 * and which owns three decisions none of those pieces can make on their
 * own: when to stop early, in what order the in-app row and the push
 * happen, and which of the four outcomes a Netlify log will show. Below
 * it sits `sendPush`, the one place a push service's answer is turned
 * into "keep this subscription" or "throw it away".
 *
 * Both were uncovered. Both decide whether a family hears anything.
 */
const { sendPushMock } = vi.hoisted(() => ({ sendPushMock: vi.fn() }))

vi.mock('../../netlify/functions/lib/webPush', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../netlify/functions/lib/webPush')>()
  return { ...actual, sendPush: sendPushMock }
})

const { notifyStudent, notifyStudents } = await import(
  '../../netlify/functions/lib/notifyStudent'
)

// The real transport, deliberately reached past the mock above: the
// orchestration tests need `sendPush` stubbed, and its own tests need it
// intact.
const { sendPush, vapidConfigured } = await vi.importActual<
  typeof import('../../netlify/functions/lib/webPush')
>('../../netlify/functions/lib/webPush')
const webpush = (await import('web-push')).default

const SUB = (id: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  // A real 65-byte P-256 point and 16-byte auth secret: since
  // `isValidSubscription` checks the decoded lengths, a placeholder
  // string here would make every recipient below unreachable and
  // quietly turn these into tests of the empty case.
  keys: {
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=',
    auth: 'tBHItJI5svbpez7KI4CCXg==',
  },
})

const TODAY = '2026-08-15'

interface Rows {
  students?: { id: string; full_name: string; parent_id: string; user_id: string | null }[]
  users?: { id: string; locale: string; push_sub: unknown }[]
  studentsError?: unknown
  usersError?: unknown
}

/**
 * Enough of a Supabase client for the orchestration: two `select …in`
 * reads, and the `upsert` the notification centre rows go through. Every
 * call is recorded, because the order of the two writes is one of the
 * things being asserted.
 */
function fakeClient(rows: Rows) {
  const calls: string[] = []
  const upserted: unknown[] = []
  const client = {
    from(table: string) {
      calls.push(`select:${table}`)
      return {
        select: () => ({
          in: () => {
            if (table === 'students') {
              return Promise.resolve({
                data: rows.studentsError ? null : (rows.students ?? []),
                error: rows.studentsError ?? null,
              })
            }
            return Promise.resolve({
              data: rows.usersError ? null : (rows.users ?? []),
              error: rows.usersError ?? null,
            })
          },
        }),
        upsert: (values: unknown, options: unknown) => {
          calls.push(`upsert:${table}`)
          upserted.push({ values, options })
          return {
            select: () => Promise.resolve({ data: values as unknown[], error: null }),
          }
        },
        update: () => ({
          eq: () => {
            calls.push(`update:${table}`)
            return Promise.resolve({ error: null })
          },
        }),
      }
    },
  } as unknown as Parameters<typeof notifyStudents>[0]
  return { client, calls, upserted }
}

const student = (over: Partial<Rows['students'[number]] & object> = {}) => ({
  id: 'student-1',
  full_name: 'Ali Rahman',
  parent_id: 'parent-1',
  user_id: null,
  ...over,
})

describe('notifyStudents — the sequence every sender shares', () => {
  beforeEach(() => {
    sendPushMock.mockReset()
    sendPushMock.mockResolvedValue({ status: 'sent' })
    vi.stubEnv('VAPID_PUBLIC_KEY', 'test-public')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'test-private')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('records the in-app row before pushing, and reports both', async () => {
    // The order matters and is not incidental. The notification centre is
    // the channel that works for everybody (ADR-017); push is the one
    // that fails for whole platforms at a time. Pushing first and
    // recording second would mean a crash between them leaves a family
    // with a lock-screen notice and nothing to open.
    const { client, calls } = fakeClient({
      students: [student()],
      users: [{ id: 'parent-1', locale: 'id', push_sub: SUB('parent-1') }],
    })
    // The push lands in the same log as the database calls, so the two
    // can be ordered against each other rather than merely counted.
    sendPushMock.mockImplementation(async () => {
      calls.push('push')
      return { status: 'sent' }
    })

    const result = await notifyStudents(client, {
      studentIds: ['student-1'],
      event: 'absence',
      audience: 'parent',
      date: TODAY,
    })

    expect(result.recorded).toBe(1)
    expect(result.sent).toBe(1)
    expect(result.skipped).toBeUndefined()
    expect(calls).toEqual([
      'select:students',
      'select:users',
      'select:notifications',
      'upsert:notifications',
      'push',
    ])
  })

  it('says "no such student" and touches nothing when the ids resolve to nothing', async () => {
    // A webhook can arrive for a row that has since been deleted. The
    // four skip reasons exist so a quiet Function is legible in a Netlify
    // log — "nothing happened" and "nothing was supposed to happen" look
    // identical otherwise, and this feature's failures are all silent.
    const { client, calls } = fakeClient({ students: [] })
    const result = await notifyStudents(client, {
      studentIds: ['ghost'],
      event: 'absence',
      audience: 'parent',
      date: TODAY,
    })
    expect(result).toMatchObject({ skipped: 'no such student', recorded: 0, sent: 0 })
    expect(calls).not.toContain('upsert:notifications')
    expect(sendPushMock).not.toHaveBeenCalled()
  })

  it('distinguishes "no account to tell" from "nobody to push to"', async () => {
    // A child whose parent has no `users` row yet — enrolled before the
    // invitation was accepted. There is nobody to write a centre row for,
    // which is a different outcome from a family who simply has push
    // switched off, and the two must not be reported as one.
    const { client, calls } = fakeClient({ students: [student()], users: [] })
    const result = await notifyStudents(client, {
      studentIds: ['student-1'],
      event: 'absence',
      audience: 'parent',
      date: TODAY,
    })
    expect(result).toMatchObject({ skipped: 'no recipient account', recorded: 0 })
    expect(calls).not.toContain('upsert:notifications')
  })

  it('still records the in-app row when nobody has push switched on', async () => {
    // The normal outcome for most of the TPA, and the case ADR-017 was
    // written for: the centre is the channel that does not depend on a
    // permission prompt, an iOS home-screen install, or a push service.
    const { client } = fakeClient({
      students: [student()],
      users: [{ id: 'parent-1', locale: 'id', push_sub: null }],
    })
    const result = await notifyStudents(client, {
      studentIds: ['student-1'],
      event: 'absence',
      audience: 'parent',
      date: TODAY,
    })
    expect(result).toMatchObject({ skipped: 'no push subscription', recorded: 1, sent: 0 })
    expect(sendPushMock).not.toHaveBeenCalled()
  })

  it('records for everyone and pushes only to the reachable', async () => {
    // A mixed class, which is every class. One unreachable family must
    // not cost the others their push, and must still get their row.
    const { client } = fakeClient({
      students: [
        student({ id: 's1', parent_id: 'p1' }),
        student({ id: 's2', parent_id: 'p2', full_name: 'Zainab' }),
      ],
      users: [
        { id: 'p1', locale: 'id', push_sub: SUB('p1') },
        { id: 'p2', locale: 'nl', push_sub: null },
      ],
    })
    const result = await notifyStudents(client, {
      studentIds: ['s1', 's2'],
      event: 'newAssignment',
      audience: 'family',
      date: TODAY,
    })
    expect(result.recorded).toBe(2)
    expect(result.sent).toBe(1)
    expect(sendPushMock).toHaveBeenCalledTimes(1)
  })

  it('treats an unreadable students query as "no such student" rather than throwing', async () => {
    // A webhook Function that throws is retried by Postgres; one that
    // reports a skip is not. Neither is obviously right, but the choice
    // has to be the same on every sender, and it is made here.
    const { client } = fakeClient({ studentsError: { message: 'connection reset' } })
    await expect(
      notifyStudents(client, {
        studentIds: ['student-1'],
        event: 'absence',
        audience: 'parent',
        date: TODAY,
      }),
    ).resolves.toMatchObject({ skipped: 'no such student' })
  })

  it('notifyStudent is the single-child spelling of the same call', async () => {
    const { client } = fakeClient({
      students: [student()],
      users: [{ id: 'parent-1', locale: 'id', push_sub: SUB('parent-1') }],
    })
    const result = await notifyStudent(client, {
      studentId: 'student-1',
      event: 'absence',
      audience: 'parent',
      date: TODAY,
    })
    expect(result).toMatchObject({ recorded: 1, sent: 1 })
  })
})

describe('sendPush — what a push service’s answer means', () => {
  beforeEach(() => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'BFakePublicKeyForTestingOnly')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'fake-private-key-for-testing')
    vi.restoreAllMocks()
  })
  afterEach(() => vi.unstubAllEnvs())

  const payload = { title: 'Kehadiran', body: 'Ali tidak hadir', tag: 'absence:u:s:2026-08-15' }

  it('reports a delivered notification as sent', async () => {
    vi.spyOn(webpush, 'setVapidDetails').mockImplementation(() => {})
    const spy = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({} as never)
    await expect(sendPush(SUB('a'), payload)).resolves.toEqual({ status: 'sent' })

    // A "not present today" notice is worthless tomorrow, so it is given
    // a TTL rather than being queued indefinitely by the push service.
    const options = spy.mock.calls[0][2] as { TTL: number; urgency: string }
    expect(options.TTL).toBe(60 * 60 * 12)
    expect(options.urgency).toBe('normal')
    // The payload travels as JSON, and it is the server-built one — the
    // browser never composes notification text (DPIA R6).
    expect(JSON.parse(spy.mock.calls[0][1] as string)).toEqual(payload)
  })

  it.each([404, 410])('reports a %s from the push service as gone, not as a failure', async (statusCode) => {
    // The distinction the caller acts on: `gone` clears `users.push_sub`,
    // and `failed` leaves it alone. Getting it backwards either drops a
    // working subscription on a transient error, or keeps a dead one and
    // burns a request on every send forever.
    vi.spyOn(webpush, 'setVapidDetails').mockImplementation(() => {})
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue(
      Object.assign(new Error('gone'), { statusCode }),
    )
    await expect(sendPush(SUB('a'), payload)).resolves.toEqual({ status: 'gone' })
  })

  it('keeps the subscription on any other error, and carries the reason', async () => {
    vi.spyOn(webpush, 'setVapidDetails').mockImplementation(() => {})
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue(
      Object.assign(new Error('service unavailable'), { statusCode: 503 }),
    )
    await expect(sendPush(SUB('a'), payload)).resolves.toEqual({
      status: 'failed',
      statusCode: 503,
      message: 'service unavailable',
    })
  })

  it('survives a rejection that is not an Error at all', async () => {
    // `web-push` rejects with a plain object in some paths. An
    // orchestrator that crashed here would lose the rest of the class.
    vi.spyOn(webpush, 'setVapidDetails').mockImplementation(() => {})
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue('nope')
    await expect(sendPush(SUB('a'), payload)).resolves.toEqual({
      status: 'failed',
      statusCode: undefined,
      message: 'nope',
    })
  })

  it('knows whether VAPID keys are configured at all', () => {
    expect(vapidConfigured()).toBe(true)
    vi.stubEnv('VAPID_PRIVATE_KEY', '')
    expect(vapidConfigured()).toBe(false)
  })
})
