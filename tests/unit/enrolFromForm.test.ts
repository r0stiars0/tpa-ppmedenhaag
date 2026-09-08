import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceClient } from '../../netlify/functions/lib/callerAuth'
import { enrolFromForm, parseEnrolPayload } from '../../netlify/functions/lib/enrolFromForm'

/**
 * Form-driven enrolment (TAD ADR-043, PRD FR-010). The handler is a thin
 * shell; the parsing, the parent- and student-resolution branches
 * (e-mail lookup first, GoTrue only on a miss), the invitation-only-on-
 * first-create rule, and the "every submission is logged" guarantee are
 * all asserted here.
 */

const { sendEmailMock, invitationEmailMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(async () => ({ status: 'sent', id: 'email_1' })),
  invitationEmailMock: vi.fn(() => ({ subject: 'S', html: '<p>H</p>', text: 'T' })),
}))
vi.mock('../../netlify/functions/lib/email', () => ({ sendEmail: sendEmailMock }))
vi.mock('../../netlify/functions/lib/emailTemplates', () => ({ invitationEmail: invitationEmailMock }))

const PARENT_ID = 'p0000000-0000-0000-0000-000000000001'
const STUDENT_ID = 's0000000-0000-0000-0000-000000000001'
const STU_AUTH_ID = 'a0000000-0000-0000-0000-0000000000c1'

const RPC_ROW = {
  parent_user_id: PARENT_ID,
  student_id: STUDENT_ID,
  parent_created: true,
  student_created: true,
  student_account_created: false,
  status: 'enrolled' as const,
}

interface FakeOpts {
  /** default row for `from('users').eq('email', …).maybeSingle()` */
  existingUser?: { id: string; role: string } | null
  /** per-e-mail override of the above (parent + student lookups share the path) */
  usersByEmail?: Record<string, { id: string; role?: string } | null>
  userLookupError?: { message: string } | null
  /** default createUser result */
  createUser?: { data: { user: { id: string } | null }; error: { code?: string; message: string } | null }
  /** per-e-mail createUser override */
  createUserByEmail?: Record<
    string,
    { data: { user: { id: string } | null }; error: { code?: string; message: string } | null }
  >
  rpc?: { data: unknown; error: { message: string } | null }
  insertError?: { message: string } | null
}

function fakeClient(opts: FakeOpts = {}) {
  const inserted: Array<Record<string, unknown>> = []
  const createUserEmails: string[] = []

  const createUser = vi.fn(async ({ email }: { email: string }) => {
    createUserEmails.push(email)
    return (
      opts.createUserByEmail?.[email] ??
      opts.createUser ?? { data: { user: { id: PARENT_ID } }, error: null }
    )
  })
  const rpc = vi.fn(async () => opts.rpc ?? { data: [RPC_ROW], error: null })

  const client = {
    from(table: string) {
      if (table === 'users') {
        return {
          select: () => ({
            eq: (_col: string, value: string) => ({
              maybeSingle: async () => ({
                data:
                  opts.usersByEmail && value in opts.usersByEmail
                    ? opts.usersByEmail[value]
                    : (opts.existingUser ?? null),
                error: opts.userLookupError ?? null,
              }),
            }),
          }),
        }
      }
      // enrolment_submissions
      return {
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row)
          return { error: opts.insertError ?? null }
        },
      }
    },
    auth: { admin: { createUser } },
    rpc,
  } as unknown as ServiceClient

  return { client, inserted, createUser, createUserEmails, rpc }
}

const GOOD = {
  submitted_at: '2026-09-01T10:00:00.000Z',
  verified_email: 'Wali@Example.com',
  parent_name: '  Budi Santoso  ',
  student_name: '  Ali Santoso  ',
  date_of_birth: '2016-03-04',
  locale: 'Nederlands',
  relation: 'ayah',
  student_email: '',
  consent: 'Saya telah membaca kebijakan privasi',
}

describe('parseEnrolPayload', () => {
  it('normalises e-mail, trims names, maps locale, keeps a real DOB', () => {
    const r = parseEnrolPayload(GOOD)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.verified_email).toBe('wali@example.com')
    expect(r.value.parent_name).toBe('Budi Santoso')
    expect(r.value.student_name).toBe('Ali Santoso')
    expect(r.value.locale).toBe('nl')
    expect(r.value.date_of_birth).toBe('2016-03-04')
    expect(r.value.relation).toBe('ayah')
  })

  it('defaults a missing/odd locale to id', () => {
    expect((parseEnrolPayload({ ...GOOD, locale: undefined }) as { value: { locale: string } }).value.locale).toBe('id')
    expect((parseEnrolPayload({ ...GOOD, locale: 'Bahasa Indonesia' }) as { value: { locale: string } }).value.locale).toBe('id')
  })

  it('accepts a locale-formatted date and a bare Date string', () => {
    expect((parseEnrolPayload({ ...GOOD, date_of_birth: '3/4/2016' }) as { value: { date_of_birth: string } }).value.date_of_birth).toBe('2016-03-04')
  })

  it('rejects a non-date and a future date', () => {
    expect(parseEnrolPayload({ ...GOOD, date_of_birth: 'not a date' }).ok).toBe(false)
    const nextYear = new Date(Date.now() + 366 * 864e5).toISOString().slice(0, 10)
    expect(parseEnrolPayload({ ...GOOD, date_of_birth: nextYear }).ok).toBe(false)
  })

  it('requires a valid e-mail, a parent name, a student name', () => {
    expect(parseEnrolPayload({ ...GOOD, verified_email: 'nope' }).ok).toBe(false)
    expect(parseEnrolPayload({ ...GOOD, parent_name: '   ' }).ok).toBe(false)
    expect(parseEnrolPayload({ ...GOOD, student_name: '' }).ok).toBe(false)
    expect(parseEnrolPayload({ ...GOOD, parent_name: 'x'.repeat(121) }).ok).toBe(false)
  })

  it('records consent when given, and enrols anyway when it is blank / falsy (ADR-044)', () => {
    const given = parseEnrolPayload({ ...GOOD, consent: 'Saya setuju' })
    expect(given.ok).toBe(true)
    if (given.ok) expect(given.value.consent).toBe(true)

    for (const consent of ['', '   ', 'false', 'Tidak', 'Nee', false, undefined]) {
      const r = parseEnrolPayload({ ...GOOD, consent })
      expect(r.ok).toBe(true) // no longer a 400 — consent is recorded, not required
      if (r.ok) expect(r.value.consent).toBe(false)
    }
  })

  it('drops an over-long relation to null and a blank student e-mail to null', () => {
    const r = parseEnrolPayload({ ...GOOD, relation: 'x'.repeat(41), student_email: '  ' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.relation).toBeNull()
    expect(r.value.student_email).toBeNull()
  })

  it('lower-cases the student e-mail', () => {
    const r = parseEnrolPayload({ ...GOOD, student_email: '  Kid16@Example.com ' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.student_email).toBe('kid16@example.com')
  })

  it('treats a non-empty but invalid student e-mail as absent (enrol guardian-only)', () => {
    for (const bad of ['-', 'tidak ada', 'n/a', 'kid16', 'kid16@']) {
      const r = parseEnrolPayload({ ...GOOD, student_email: bad })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.student_email).toBeNull()
    }
  })

  it('ignores a payment answer entirely (out of scope)', () => {
    const r = parseEnrolPayload({ ...GOOD, payment_answer: 'Tidak' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).not.toHaveProperty('payment_answer')
  })

  it('flattens a one-element array value (Apps Script namedValues shape)', () => {
    const r = parseEnrolPayload({ ...GOOD, parent_name: ['Budi Santoso'], consent: ['Ya, setuju'] })
    expect(r.ok).toBe(true)
  })
})

describe('enrolFromForm', () => {
  beforeEach(() => {
    sendEmailMock.mockClear()
    invitationEmailMock.mockClear()
    sendEmailMock.mockResolvedValue({ status: 'sent', id: 'email_1' })
  })

  it('a bad payload is logged as an error row and returns 400, no account touched', async () => {
    const { client, inserted, createUser, rpc } = fakeClient()
    const res = await enrolFromForm(client, { ...GOOD, verified_email: 'bad' })
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(createUser).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ status: 'error' })
  })

  it('a new family: creates the auth user, calls the RPC, sends the invite, logs enrolled', async () => {
    const { client, inserted, createUser, rpc } = fakeClient()
    const res = await enrolFromForm(client, GOOD)
    expect(res).toMatchObject({
      ok: true,
      status: 201,
      data: {
        status: 'enrolled',
        parent_user_id: PARENT_ID,
        student_id: STUDENT_ID,
        invitation_email: 'sent',
        student_invitation_email: null,
      },
    })
    expect(createUser).toHaveBeenCalledWith({ email: 'wali@example.com', email_confirm: true })
    expect(rpc).toHaveBeenCalledWith(
      'fn_enrol_from_form',
      expect.objectContaining({
        p_parent_id: PARENT_ID,
        p_parent_email: 'wali@example.com',
        p_parent_name: 'Budi Santoso',
        p_locale: 'nl',
        p_student_name: 'Ali Santoso',
        p_dob: '2016-03-04',
        p_relation: 'ayah',
        p_student_email: undefined,
        p_student_auth_id: undefined,
      }),
    )
    expect(invitationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'parent', locale: 'nl', email: 'wali@example.com' }),
    )
    expect(inserted.at(-1)).toMatchObject({ status: 'enrolled', error: null })
  })

  it('an existing public.users row by e-mail: no GoTrue call, no invite e-mail', async () => {
    const { client, createUser, rpc } = fakeClient({
      existingUser: { id: PARENT_ID, role: 'parent' },
      rpc: { data: [{ ...RPC_ROW, parent_created: false, student_created: false, status: 'updated' }], error: null },
    })
    const res = await enrolFromForm(client, GOOD)
    expect(res).toMatchObject({ ok: true, data: { status: 'updated', invitation_email: null } })
    expect(createUser).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('createUser reports email_exists with no profile: needs_attention, ok, no throw', async () => {
    const { client, inserted, rpc } = fakeClient({
      createUser: { data: { user: null }, error: { code: 'email_exists', message: 'already registered' } },
    })
    const res = await enrolFromForm(client, GOOD)
    expect(res).toMatchObject({ ok: true, status: 200, data: { status: 'needs_attention', parent_user_id: null } })
    expect(rpc).not.toHaveBeenCalled()
    expect(inserted.at(-1)).toMatchObject({ status: 'needs_attention' })
  })

  it('a createUser failure other than email_exists is a 502 error row', async () => {
    const { client, inserted } = fakeClient({
      createUser: { data: { user: null }, error: { message: 'GoTrue down' } },
    })
    const res = await enrolFromForm(client, GOOD)
    expect(res).toMatchObject({ ok: false, status: 502 })
    expect(inserted.at(-1)).toMatchObject({ status: 'error', error: 'GoTrue down' })
  })

  it('an RPC error is logged as an error row and returned as 500', async () => {
    const { client, inserted } = fakeClient({ rpc: { data: null, error: { message: 'deadlock' } } })
    const res = await enrolFromForm(client, GOOD)
    expect(res).toMatchObject({ ok: false, status: 500, error: 'deadlock' })
    expect(inserted.at(-1)).toMatchObject({ status: 'error', error: 'deadlock' })
  })

  it('a failed invitation e-mail does not fail the enrolment', async () => {
    sendEmailMock.mockResolvedValue({ status: 'failed', statusCode: 500, message: 'nope' })
    const { client } = fakeClient()
    const res = await enrolFromForm(client, GOOD)
    expect(res).toMatchObject({ ok: true, status: 201, data: { status: 'enrolled', invitation_email: 'failed' } })
  })

  it('does not send an invite when the RPC created the student but reused an existing account', async () => {
    const { client } = fakeClient({
      existingUser: { id: PARENT_ID, role: 'tutor' },
      rpc: { data: [{ ...RPC_ROW, parent_created: false, student_created: true, status: 'enrolled' }], error: null },
    })
    const res = await enrolFromForm(client, GOOD)
    expect(res).toMatchObject({ ok: true, data: { status: 'enrolled', invitation_email: null } })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('propagates a needs_attention from the RPC (name+DOB match, not a guardian)', async () => {
    const { client, inserted } = fakeClient({
      existingUser: { id: PARENT_ID, role: 'parent' },
      rpc: {
        data: [
          {
            parent_user_id: PARENT_ID,
            student_id: null,
            parent_created: false,
            student_created: false,
            student_account_created: false,
            status: 'needs_attention',
          },
        ],
        error: null,
      },
    })
    const res = await enrolFromForm(client, GOOD)
    expect(res).toMatchObject({ ok: true, status: 201, data: { status: 'needs_attention', student_id: null } })
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(inserted.at(-1)).toMatchObject({ status: 'needs_attention', error: null })
  })

  // ── student self-login (PRD #10) ─────────────────────────────────────

  const WITH_STUDENT_EMAIL = { ...GOOD, student_email: 'ali16@example.com' }

  it('a fresh student e-mail: createUser for the student, id passed as p_student_auth_id', async () => {
    const { client, createUserEmails, rpc } = fakeClient({
      existingUser: { id: PARENT_ID, role: 'parent' }, // parent already exists → only the student is createUser'd
      createUserByEmail: { 'ali16@example.com': { data: { user: { id: STU_AUTH_ID } }, error: null } },
      usersByEmail: { 'ali16@example.com': null },
    })
    await enrolFromForm(client, WITH_STUDENT_EMAIL)
    expect(createUserEmails).toEqual(['ali16@example.com'])
    expect(rpc).toHaveBeenCalledWith(
      'fn_enrol_from_form',
      expect.objectContaining({ p_student_email: 'ali16@example.com', p_student_auth_id: STU_AUTH_ID }),
    )
  })

  it('an existing student profile by e-mail: no student createUser, RPC still gets the e-mail', async () => {
    const { client, createUserEmails, rpc } = fakeClient({
      usersByEmail: {
        'wali@example.com': null, // parent still created
        'ali16@example.com': { id: STU_AUTH_ID, role: 'student' },
      },
    })
    await enrolFromForm(client, WITH_STUDENT_EMAIL)
    expect(createUserEmails).toEqual(['wali@example.com']) // parent only
    expect(rpc).toHaveBeenCalledWith(
      'fn_enrol_from_form',
      expect.objectContaining({ p_student_email: 'ali16@example.com', p_student_auth_id: undefined }),
    )
  })

  it('student e-mail == verified e-mail: no student lookup or createUser for it', async () => {
    const { client, createUserEmails } = fakeClient({
      existingUser: { id: PARENT_ID, role: 'parent' },
    })
    await enrolFromForm(client, { ...GOOD, student_email: GOOD.verified_email })
    expect(createUserEmails).toEqual([]) // parent exists, student e-mail is the parent's own
  })

  it('student createUser email_exists: leaves p_student_auth_id undefined for the RPC to resolve', async () => {
    const { client, rpc } = fakeClient({
      existingUser: { id: PARENT_ID, role: 'parent' },
      createUserByEmail: {
        'ali16@example.com': { data: { user: null }, error: { code: 'email_exists', message: 'exists' } },
      },
      usersByEmail: { 'ali16@example.com': null },
    })
    const res = await enrolFromForm(client, WITH_STUDENT_EMAIL)
    expect(res.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith(
      'fn_enrol_from_form',
      expect.objectContaining({ p_student_email: 'ali16@example.com', p_student_auth_id: undefined }),
    )
  })

  it('student createUser hard failure → 502 error row', async () => {
    const { client, inserted } = fakeClient({
      existingUser: { id: PARENT_ID, role: 'parent' },
      createUserByEmail: {
        'ali16@example.com': { data: { user: null }, error: { message: 'GoTrue exploded' } },
      },
      usersByEmail: { 'ali16@example.com': null },
    })
    const res = await enrolFromForm(client, WITH_STUDENT_EMAIL)
    expect(res).toMatchObject({ ok: false, status: 502 })
    expect(inserted.at(-1)).toMatchObject({ status: 'error', error: 'GoTrue exploded' })
  })

  it('student_account_created from the RPC → the student gets their own invitation', async () => {
    const { client } = fakeClient({
      existingUser: { id: PARENT_ID, role: 'parent' },
      createUserByEmail: { 'ali16@example.com': { data: { user: { id: STU_AUTH_ID } }, error: null } },
      usersByEmail: { 'ali16@example.com': null },
      rpc: {
        data: [{ ...RPC_ROW, parent_created: false, student_account_created: true, status: 'enrolled' }],
        error: null,
      },
    })
    const res = await enrolFromForm(client, WITH_STUDENT_EMAIL)
    expect(res).toMatchObject({ ok: true, data: { student_invitation_email: 'sent' } })
    expect(invitationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'student', email: 'ali16@example.com', fullName: 'Ali Santoso' }),
    )
  })

  it('no student invitation when the RPC did not create a student profile', async () => {
    const { client } = fakeClient({
      existingUser: { id: PARENT_ID, role: 'parent' },
      usersByEmail: { 'ali16@example.com': { id: STU_AUTH_ID, role: 'student' } },
      rpc: {
        data: [{ ...RPC_ROW, parent_created: false, student_account_created: false, status: 'updated' }],
        error: null,
      },
    })
    const res = await enrolFromForm(client, WITH_STUDENT_EMAIL)
    expect(res).toMatchObject({ ok: true, data: { student_invitation_email: null } })
    expect(invitationEmailMock).not.toHaveBeenCalledWith(expect.objectContaining({ role: 'student' }))
  })
})
