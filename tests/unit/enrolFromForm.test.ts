import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceClient } from '../../netlify/functions/lib/callerAuth'
import { enrolFromForm, parseEnrolPayload } from '../../netlify/functions/lib/enrolFromForm'

/**
 * Form-driven enrolment (TAD ADR-043, PRD FR-010). The handler is a thin
 * shell; the parsing, the parent-resolution branch (e-mail lookup first,
 * GoTrue only on a miss), the one invitation-e-mail-only-on-first-create
 * rule, and the "every submission is logged" guarantee are all asserted
 * here.
 */

const { sendEmailMock, invitationEmailMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(async () => ({ status: 'sent', id: 'email_1' })),
  invitationEmailMock: vi.fn(() => ({ subject: 'S', html: '<p>H</p>', text: 'T' })),
}))
vi.mock('../../netlify/functions/lib/email', () => ({ sendEmail: sendEmailMock }))
vi.mock('../../netlify/functions/lib/emailTemplates', () => ({ invitationEmail: invitationEmailMock }))

const RPC_ROW = {
  parent_user_id: 'p0000000-0000-0000-0000-000000000001',
  student_id: 's0000000-0000-0000-0000-000000000001',
  parent_created: true,
  student_created: true,
  status: 'enrolled' as const,
}

interface FakeOpts {
  /** row returned by `from('users').select().eq('email').maybeSingle()` */
  existingUser?: { id: string; role: string } | null
  userLookupError?: { message: string } | null
  createUser?: { data: { user: { id: string } | null }; error: { code?: string; message: string } | null }
  rpc?: { data: unknown; error: { message: string } | null }
  insertError?: { message: string } | null
}

function fakeClient(opts: FakeOpts = {}) {
  const inserted: Array<Record<string, unknown>> = []
  const createUser = vi.fn(
    async () => opts.createUser ?? { data: { user: { id: RPC_ROW.parent_user_id } }, error: null },
  )
  const rpc = vi.fn(async () => opts.rpc ?? { data: [RPC_ROW], error: null })

  const client = {
    from(table: string) {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.existingUser ?? null,
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

  return { client, inserted, createUser, rpc }
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
  payment_answer: 'Ya',
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

  it('treats a blank / "Tidak" / "false" consent as not given', () => {
    for (const consent of ['', '   ', 'false', 'Tidak', 'Nee', false]) {
      expect(parseEnrolPayload({ ...GOOD, consent }).ok).toBe(false)
    }
  })

  it('drops an over-long relation to null and a blank student e-mail to null', () => {
    const r = parseEnrolPayload({ ...GOOD, relation: 'x'.repeat(41), student_email: '  ' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.relation).toBeNull()
    expect(r.value.student_email).toBeNull()
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
      data: { status: 'enrolled', parent_user_id: RPC_ROW.parent_user_id, student_id: RPC_ROW.student_id, invitation_email: 'sent' },
    })
    expect(createUser).toHaveBeenCalledWith({ email: 'wali@example.com', email_confirm: true })
    expect(rpc).toHaveBeenCalledWith(
      'fn_enrol_from_form',
      expect.objectContaining({
        p_parent_id: RPC_ROW.parent_user_id,
        p_parent_email: 'wali@example.com',
        p_parent_name: 'Budi Santoso',
        p_locale: 'nl',
        p_student_name: 'Ali Santoso',
        p_dob: '2016-03-04',
        p_relation: 'ayah',
      }),
    )
    expect(invitationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'parent', locale: 'nl', email: 'wali@example.com' }),
    )
    expect(inserted.at(-1)).toMatchObject({ status: 'enrolled', error: null })
  })

  it('an existing public.users row by e-mail: no GoTrue call, no invite e-mail', async () => {
    const { client, createUser, rpc } = fakeClient({
      existingUser: { id: RPC_ROW.parent_user_id, role: 'parent' },
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
    // parent_created false → the account already existed even though this
    // is the child's first enrolment. No welcome e-mail (FE-4).
    const { client } = fakeClient({
      existingUser: { id: RPC_ROW.parent_user_id, role: 'tutor' },
      rpc: { data: [{ ...RPC_ROW, parent_created: false, student_created: true, status: 'enrolled' }], error: null },
    })
    const res = await enrolFromForm(client, GOOD)
    expect(res).toMatchObject({ ok: true, data: { status: 'enrolled', invitation_email: null } })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})
