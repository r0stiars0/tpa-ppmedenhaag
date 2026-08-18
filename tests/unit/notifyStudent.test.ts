import { describe, expect, it, vi } from 'vitest'
import {
  buildAudiences,
  dispatch,
  type DispatchDeps,
  type StudentAudience,
  recordNotifications,
  reportable,
  type StudentRow,
  type UserRow,
} from '../../netlify/functions/lib/notifyStudent'
import type { SendResult } from '../../netlify/functions/lib/webPush'

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

/**
 * An account row as `audiencesForStudents` loads it. There is no `role`
 * on it, and that is the subject of half the cases below: since ADR-022
 * the recipient rule is the child's own `parent_id`/`user_id`, and what
 * role the account behind those columns happens to hold is not a
 * question this module can ask.
 */
const account = (id: string, locale: 'id' | 'nl' = 'id'): UserRow => ({
  id,
  locale,
  push_sub: SUB(id),
})

const student = (over: Partial<StudentRow> = {}): StudentRow => ({
  id: 'student-1',
  full_name: 'Ali Rahman',
  parent_id: 'parent-1',
  user_id: null,
  ...over,
})

describe('who receives a notification about a child', () => {
  it('sends to the child’s own parent', () => {
    const [audience] = buildAudiences([student()], [account('parent-1')], 'parent')
    expect(audience.recipients.map((r) => r.userId)).toEqual(['parent-1'])
    expect(audience.childFullName).toBe('Ali Rahman')
  })

  it('NEVER pairs a child with another family’s parent', () => {
    // The property test-plan §1 calls "a GDPR incident, not a bug".
    // Two families' rows arrive in one batch — a class roster — and each
    // child must resolve to their own parent only.
    const audiences = buildAudiences(
      [
        student({ id: 'child-a', full_name: 'Ali', parent_id: 'parent-1' }),
        student({ id: 'child-b', full_name: 'Fatimah', parent_id: 'parent-2' }),
      ],
      [account('parent-1'), account('parent-2')],
      'parent',
    )

    expect(audiences[0].recipients.map((r) => r.userId)).toEqual(['parent-1'])
    expect(audiences[1].recipients.map((r) => r.userId)).toEqual(['parent-2'])
    for (const audience of audiences) {
      expect(audience.recipients).toHaveLength(1)
    }
  })

  it('adds the 16+ student only for a family audience', () => {
    const rows = [student({ user_id: 'student-user-1' })]
    const users = [account('parent-1'), account('student-user-1')]

    expect(buildAudiences(rows, users, 'parent')[0].recipients.map((r) => r.userId)).toEqual([
      'parent-1',
    ])
    expect(buildAudiences(rows, users, 'family')[0].recipients.map((r) => r.userId)).toEqual([
      'parent-1',
      'student-user-1',
    ])
  })

  it('does not notify the same account twice', () => {
    // Defensive: if a 16+ student's own account were also recorded as
    // the parent contact, a family audience must still be one delivery.
    const audiences = buildAudiences(
      [student({ parent_id: 'user-1', user_id: 'user-1' })],
      [account('user-1')],
      'family',
    )
    expect(audiences[0].recipients).toHaveLength(1)
  })

  it('notifies a tutor about their OWN child', () => {
    // The bug ADR-022 fixes. `tutor-parent-1` holds `users.role =
    // 'tutor'` and is also the `parent_id` on this row — a shape the TPA
    // has several of. Under the old role filter they received nothing
    // about their own child: no push, no in-app row, and no way to store
    // a subscription in the first place.
    //
    // There is no role on `UserRow` to set any more, which is the point:
    // the case cannot regress by someone re-adding a role test here,
    // because the data to test would have to come back first.
    const [audience] = buildAudiences(
      [student({ parent_id: 'tutor-parent-1' })],
      [account('tutor-parent-1')],
      'parent',
    )
    expect(audience.recipients.map((r) => r.userId)).toEqual(['tutor-parent-1'])
  })

  it('notifies an admin about their OWN child, and nobody else’s', () => {
    // ADR-014 made admin a super admin over the operational *screens*;
    // ADR-017(d) is the one place that does not reach, and it still does
    // not. An admin who is a parent is a recipient here exactly like any
    // other parent, and exactly as narrowly: the other family's child in
    // the same batch resolves to their own parent alone.
    const audiences = buildAudiences(
      [
        student({ id: 'own', full_name: 'Salma', parent_id: 'admin-parent-1' }),
        student({ id: 'other', full_name: 'Ali', parent_id: 'parent-2' }),
      ],
      [account('admin-parent-1'), account('parent-2')],
      'family',
    )
    expect(audiences[0].recipients.map((r) => r.userId)).toEqual(['admin-parent-1'])
    expect(audiences[1].recipients.map((r) => r.userId)).toEqual(['parent-2'])
  })

  it('NEVER notifies a tutor about a child in the class they teach', () => {
    // The half of ADR-015(a) that survives ADR-022, and the single most
    // important property in this file: a tutor learns about an absence
    // by recording it, and subscribing one account to a whole class's
    // lock screens is indefensible under data minimisation.
    //
    // It is enforced by the shape of the pairing rather than by a check
    // — `tutor-1` teaches both these children and is the `parent_id` of
    // neither, so there is no column through which they could appear.
    // The account is passed in deliberately, as `audiencesForStudents`
    // would if some other row made it a recipient elsewhere.
    const audiences = buildAudiences(
      [
        student({ id: 'pupil-a', parent_id: 'parent-1' }),
        student({ id: 'pupil-b', parent_id: 'parent-2' }),
      ],
      [account('parent-1'), account('parent-2'), account('tutor-1')],
      'family',
    )
    const everyone = audiences.flatMap((a) => a.recipients.map((r) => r.userId))
    expect(everyone).toEqual(['parent-1', 'parent-2'])
    expect(everyone).not.toContain('tutor-1')
  })

  it('tells a tutor-parent about their own child and not about their class', () => {
    // Both halves in one audience, which is the case the two rules have
    // to hold simultaneously for. The same account is `parent_id` on one
    // row and teaches the other; only the first reaches them.
    const audiences = buildAudiences(
      [
        student({ id: 'own-child', full_name: 'Yusuf', parent_id: 'tutor-parent-1' }),
        student({ id: 'pupil', full_name: 'Ali', parent_id: 'parent-2' }),
      ],
      [account('tutor-parent-1'), account('parent-2')],
      'family',
    )
    expect(audiences[0].recipients.map((r) => r.userId)).toEqual(['tutor-parent-1'])
    expect(audiences[1].recipients.map((r) => r.userId)).toEqual(['parent-2'])
    expect(audiences[1].recipients.map((r) => r.userId)).not.toContain('tutor-parent-1')
  })

  it('tells them exactly once when their own child is IN the class they teach', () => {
    // The overlap, and the most likely arrangement of the two at a small
    // TPA: the ustadzah teaching the group her own son sits in. Every
    // other dual-role case in this project — the fixtures, the pgTAP
    // block, the live harness — deliberately puts the two halves in
    // different classes so that the union can be proven, so this is the
    // configuration none of them covers.
    //
    // The two halves of ADR-022 now point at the same child: "tell a
    // parent about their own child" and "never tell a tutor about a
    // child in their class". The first must win, once. It does, and not
    // because either rule was special-cased — the pairing is keyed on
    // the child's own `parent_id`, so the class this notification is
    // fanning out over never enters the derivation at all.
    const roster = [
      student({ id: 'own-child', full_name: 'Yusuf', parent_id: 'tutor-parent-1' }),
      student({ id: 'classmate-a', full_name: 'Ali', parent_id: 'parent-2' }),
      student({ id: 'classmate-b', full_name: 'Zainab', parent_id: 'parent-3' }),
    ]
    const audiences = buildAudiences(
      roster,
      [account('tutor-parent-1'), account('parent-2'), account('parent-3')],
      'family',
    )

    const forTutorParent = audiences.flatMap((a) =>
      a.recipients.filter((r) => r.userId === 'tutor-parent-1').map(() => a.studentId),
    )
    expect(forTutorParent).toEqual(['own-child'])
    // …and the rest of the roster is untouched by their being the tutor
    // of it: each classmate still resolves to their own parent alone.
    expect(audiences[1].recipients.map((r) => r.userId)).toEqual(['parent-2'])
    expect(audiences[2].recipients.map((r) => r.userId)).toEqual(['parent-3'])
  })

  it('tells a student assistant about their own record and not their classmates’', () => {
    // The same overlap one row further along (pgTAP RLS-37): a 16+ santri
    // who assists the class they are enrolled in. At the database that
    // arrangement hands them a *write* over their own record; here it
    // hands them nothing extra at all, because the audience is built from
    // `user_id` and `parent_id` and neither says anything about who
    // teaches.
    const audiences = buildAudiences(
      [
        student({ id: 'sa-own', full_name: 'Aisyah', parent_id: 'parent-4', user_id: 'sa-1' }),
        student({ id: 'classmate', full_name: 'Ali', parent_id: 'parent-2' }),
      ],
      [account('sa-1'), account('parent-4'), account('parent-2')],
      'family',
    )
    expect(audiences[0].recipients.map((r) => r.userId)).toEqual(['parent-4', 'sa-1'])
    expect(audiences[1].recipients.map((r) => r.userId)).toEqual(['parent-2'])
  })

  it('keeps accounts with no usable subscription, with nothing to push to', () => {
    // Changed by ADR-017. These recipients used to be dropped from the
    // audience entirely, which was right when a push was the only thing
    // a notification could be. Now they are exactly who the in-app
    // notification centre exists for, so they stay — carrying
    // `subscription: null`, which is what `dispatch` filters on and
    // `recordNotifications` deliberately ignores.
    const users: UserRow[] = [
      { ...account('parent-1'), push_sub: null },
      { ...account('parent-2'), push_sub: { endpoint: 'http://not-https.example' } },
      { ...account('parent-3'), push_sub: 'nonsense' },
    ]
    const rows = [
      student({ id: 's1', parent_id: 'parent-1' }),
      student({ id: 's2', parent_id: 'parent-2' }),
      student({ id: 's3', parent_id: 'parent-3' }),
    ]
    const recipients = buildAudiences(rows, users, 'parent').flatMap((a) => a.recipients)
    expect(recipients.map((r) => r.userId)).toEqual(['parent-1', 'parent-2', 'parent-3'])
    expect(recipients.every((r) => r.subscription === null)).toBe(true)
  })

  it('keeps a recipient who is unreachable by push, which is a different thing', () => {
    // The distinction that matters: "not reachable by push" is a
    // delivery fact, "not a recipient" is an authorization one. Only the
    // second removes someone from the audience, and so from the
    // notification centre — and since ADR-022 the only thing that does
    // that is holding no relationship to the child. A tutor-parent with
    // push switched off is still owed their in-app row.
    const users: UserRow[] = [
      { ...account('tutor-parent-1'), push_sub: null },
      account('admin-parent-1'),
    ]
    const rows = [
      student({ id: 's1', parent_id: 'tutor-parent-1' }),
      student({ id: 's2', parent_id: 'admin-parent-1' }),
    ]
    const recipients = buildAudiences(rows, users, 'family').flatMap((a) => a.recipients)
    expect(recipients.map((r) => [r.userId, r.subscription !== null])).toEqual([
      ['tutor-parent-1', false],
      ['admin-parent-1', true],
    ])
  })

  it('mixes reachable and unreachable recipients in one family audience', () => {
    const users: UserRow[] = [account('parent-1'), { ...account('self-1'), push_sub: null }]
    const rows = [student({ parent_id: 'parent-1', user_id: 'self-1' })]
    const [audience] = buildAudiences(rows, users, 'family')
    expect(audience.recipients.map((r) => [r.userId, r.subscription !== null])).toEqual([
      ['parent-1', true],
      ['self-1', false],
    ])
  })

  it('keeps a student with no reachable parent in the result, with no recipients', () => {
    // The caller reports "no push subscription" rather than "no such
    // student", and a class fan-out must not drop the rest of the roster
    // because one family is unsubscribed.
    const audiences = buildAudiences(
      [student({ id: 's1', parent_id: 'parent-1' }), student({ id: 's2', parent_id: 'parent-2' })],
      [account('parent-2')],
      'parent',
    )
    expect(audiences).toHaveLength(2)
    expect(audiences[0].recipients).toEqual([])
    expect(audiences[1].recipients.map((r) => r.userId)).toEqual(['parent-2'])
  })
})

function target(over: Partial<StudentAudience> = {}): StudentAudience {
  return {
    studentId: 'student-1',
    childFullName: 'Ali Rahman',
    recipients: [{ userId: 'parent-1', locale: 'id', subscription: SUB('parent-1') }],
    ...over,
  }
}

const fakeClient = {} as Parameters<typeof dispatch>[0]

function deps(over: Partial<DispatchDeps> = {}): DispatchDeps & { cleared: string[] } {
  const cleared: string[] = []
  return {
    send: async (): Promise<SendResult> => ({ status: 'sent' }),
    clearSubscription: async (userId: string) => {
      cleared.push(userId)
    },
    cleared,
    ...over,
  }
}

describe('dispatching to a fanned-out audience', () => {
  it('sends one payload per recipient, each in their own locale', async () => {
    const sent: { body: string; tag: string }[] = []
    const d = deps({
      send: async (_sub, payload) => {
        sent.push({ body: payload.body, tag: payload.tag })
        return { status: 'sent' }
      },
    })

    await dispatch(
      fakeClient,
      [
        target({
          recipients: [
            { userId: 'parent-1', locale: 'id', subscription: SUB('a') },
            { userId: 'self-1', locale: 'nl', subscription: SUB('b') },
          ],
        }),
      ],
      'newAssignment',
      '2026-03-10',
      d,
    )

    expect(sent.map((s) => s.body)).toEqual([
      'Ada tugas baru untuk Ali',
      'Er is nieuw huiswerk voor Ali',
    ])
    expect(sent.map((s) => s.tag)).toEqual([
      'newAssignment:parent-1:student-1:2026-03-10',
      'newAssignment:self-1:student-1:2026-03-10',
    ])
  })

  it('gives one parent two siblings two distinct tags, so neither is swallowed', async () => {
    // ADR-016. With the child missing from the tag these two collapsed
    // to one lock-screen notification, and the parent was told about
    // whichever child happened to be dispatched last.
    const sent: string[] = []
    const d = deps({
      send: async (_sub, payload) => {
        sent.push(payload.tag)
        return { status: 'sent' }
      },
    })

    await dispatch(
      fakeClient,
      [
        target({ studentId: 'ali', childFullName: 'Ali Rahman' }),
        target({ studentId: 'zainab', childFullName: 'Zainab Rahman' }),
      ],
      'absence',
      '2026-03-10',
      d,
    )

    expect(sent).toEqual(['absence:parent-1:ali:2026-03-10', 'absence:parent-1:zainab:2026-03-10'])
    expect(new Set(sent).size).toBe(2)
  })

  it('names each child correctly across a whole class', async () => {
    const sent: string[] = []
    const d = deps({
      send: async (_sub, payload) => {
        sent.push(payload.body)
        return { status: 'sent' }
      },
    })

    await dispatch(
      fakeClient,
      [
        target({ childFullName: 'Ali Rahman', recipients: [{ userId: 'p1', locale: 'id', subscription: SUB('a') }] }),
        target({ childFullName: 'Zainab Putri', recipients: [{ userId: 'p2', locale: 'id', subscription: SUB('b') }] }),
      ],
      'newAssignment',
      '2026-03-10',
      d,
    )

    expect(sent).toEqual(['Ada tugas baru untuk Ali', 'Ada tugas baru untuk Zainab'])
  })

  it('one dead subscription does not cost the others their notification', async () => {
    const d = deps({
      send: async (sub) =>
        sub.endpoint.endsWith('dead') ? { status: 'gone' } : { status: 'sent' },
    })

    const result = await dispatch(
      fakeClient,
      [
        target({ recipients: [{ userId: 'p1', locale: 'id', subscription: SUB('dead') }] }),
        target({ recipients: [{ userId: 'p2', locale: 'id', subscription: SUB('alive') }] }),
      ],
      'absence',
      '2026-03-10',
      d,
    )

    expect(result.sent).toBe(1)
    expect(result.expired).toBe(1)
    expect(result.failed).toBe(0)
    expect(d.cleared).toEqual(['p1'])
  })

  it('one failed send does not stop the rest either', async () => {
    const d = deps({
      send: async (sub) =>
        sub.endpoint.endsWith('bad')
          ? { status: 'failed', statusCode: 500, message: 'push service error' }
          : { status: 'sent' },
    })

    const result = await dispatch(
      fakeClient,
      [
        target({ recipients: [{ userId: 'p1', locale: 'id', subscription: SUB('bad') }] }),
        target({ recipients: [{ userId: 'p2', locale: 'id', subscription: SUB('ok') }] }),
      ],
      'absence',
      '2026-03-10',
      d,
    )

    expect(result.sent).toBe(1)
    expect(result.failed).toBe(1)
    // A failure is not an expiry: the subscription must survive a bad
    // minute at the push service.
    expect(d.cleared).toEqual([])
  })

  it('delivers to a whole class without exceeding the concurrency bound', async () => {
    let inFlight = 0
    let peak = 0
    const d = deps({
      send: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 1))
        inFlight -= 1
        return { status: 'sent' }
      },
    })

    const roster = Array.from({ length: 30 }, (_, i) =>
      target({
        studentId: `s${i}`,
        recipients: [{ userId: `p${i}`, locale: 'id', subscription: SUB(`e${i}`) }],
      }),
    )

    const result = await dispatch(fakeClient, roster, 'newAssignment', '2026-03-10', d)

    expect(result.sent).toBe(30)
    expect(peak).toBeGreaterThan(1) // actually parallel, not sequential
    expect(peak).toBeLessThanOrEqual(10) // …but bounded
  })

  it('reports nothing sent for an audience with no recipients', async () => {
    const d = deps({ send: vi.fn() })
    const result = await dispatch(fakeClient, [target({ recipients: [] })], 'absence', '2026-03-10', d)
    expect(result).toEqual({ sent: 0, expired: 0, failed: 0, tags: [] })
    expect(d.send).not.toHaveBeenCalled()
  })
})

describe('reportable — what a Function may put in its HTTP response', () => {
  it('drops the tags, which carry a user id and a student id each', () => {
    // ADR-016. The scheduled Functions carry no shared secret and
    // answer unauthenticated HTTP under `netlify dev`, so the response
    // body is not a place for identifiers.
    const result = reportable({
      sent: 2,
      expired: 0,
      failed: 0,
      tags: ['absence:parent-1:ali:2026-03-10', 'absence:parent-1:zainab:2026-03-10'],
    })
    expect(result).toEqual({ sent: 2, expired: 0, failed: 0 })
    expect(JSON.stringify(result)).not.toContain('parent-1')
    expect(JSON.stringify(result)).not.toContain('ali')
  })

  it('keeps the skip reason, which is what a Netlify log is read for', () => {
    expect(
      reportable({ sent: 0, expired: 0, failed: 0, tags: [], skipped: 'no push subscription' }),
    ).toEqual({ sent: 0, expired: 0, failed: 0, skipped: 'no push subscription' })
  })
})

describe('recordNotifications — the in-app half (ADR-017)', () => {
  function fakeUpsertClient() {
    const calls: { rows: unknown[]; onConflict?: string }[] = []
    const client = {
      from: () => ({
        upsert: async (rows: unknown[], opts?: { onConflict?: string }) => {
          calls.push({ rows, onConflict: opts?.onConflict })
          return { error: null }
        },
      }),
    } as unknown as Parameters<typeof recordNotifications>[0]
    return { client, calls }
  }

  it('writes one row per recipient, including those with no subscription', () => {
    // The property the whole notification centre rests on: it exists
    // for the families push cannot reach, so a recipient with
    // `subscription: null` must still get a row.
    const { client, calls } = fakeUpsertClient()
    return recordNotifications(
      client,
      [
        target({
          recipients: [
            { userId: 'parent-1', locale: 'id', subscription: SUB('a') },
            { userId: 'self-1', locale: 'nl', subscription: null },
          ],
        }),
      ],
      'reportReady',
      '2026-03-10',
    ).then((recorded) => {
      expect(recorded).toBe(2)
      expect(calls[0].rows).toEqual([
        {
          user_id: 'parent-1',
          student_id: 'student-1',
          event: 'reportReady',
          context: {},
          event_date: '2026-03-10',
        },
        {
          user_id: 'self-1',
          student_id: 'student-1',
          event: 'reportReady',
          context: {},
          event_date: '2026-03-10',
        },
      ])
    })
  })

  it('upserts on the same tuple the dedup tag uses, so a re-run cannot duplicate', async () => {
    const { client, calls } = fakeUpsertClient()
    await recordNotifications(client, [target()], 'murajaahReminder', '2026-03-10')
    expect(calls[0].onConflict).toBe('user_id,student_id,event,event_date')
  })

  it('carries a constant context to every recipient', async () => {
    const { client, calls } = fakeUpsertClient()
    await recordNotifications(client, [target()], 'jilidMilestone', '2026-03-10', { number: 3 })
    expect((calls[0].rows[0] as { context: unknown }).context).toEqual({ number: 3 })
  })

  it('resolves a per-student context, which one homework run needs', async () => {
    const { client, calls } = fakeUpsertClient()
    await recordNotifications(
      client,
      [
        target({ studentId: 'ali' }),
        target({ studentId: 'zainab' }),
      ],
      'assignmentDueTomorrow',
      '2026-03-10',
      (studentId) => (studentId === 'ali' ? { title: 'Hafalan' } : { count: 2 }),
    )
    expect((calls[0].rows as { student_id: string; context: unknown }[]).map((r) => [
      r.student_id,
      r.context,
    ])).toEqual([
      ['ali', { title: 'Hafalan' }],
      ['zainab', { count: 2 }],
    ])
  })

  it('never stores the child’s name — it is joined at read time', async () => {
    const { client, calls } = fakeUpsertClient()
    await recordNotifications(client, [target()], 'absence', '2026-03-10')
    expect(JSON.stringify(calls[0].rows)).not.toContain('Ali')
  })

  it('reports 0 rather than throwing when the write fails', async () => {
    // A family losing the in-app copy of a notification is not worth
    // also withholding the push they would otherwise have received.
    const client = {
      from: () => ({ upsert: async () => ({ error: { message: 'nope' } }) }),
    } as unknown as Parameters<typeof recordNotifications>[0]
    await expect(recordNotifications(client, [target()], 'absence', '2026-03-10')).resolves.toBe(0)
  })

  it('writes nothing when there is nobody to tell', async () => {
    const { client, calls } = fakeUpsertClient()
    expect(await recordNotifications(client, [target({ recipients: [] })], 'absence', '2026-03-10')).toBe(0)
    expect(calls).toEqual([])
  })
})
