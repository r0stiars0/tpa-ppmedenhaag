import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rejectRegistration } from '../../netlify/functions/lib/rejectRegistration'
import type { ServiceClient } from '../../netlify/functions/lib/callerAuth'

/**
 * Rejecting an unapproved registration (TAD ADR-039). The Function has
 * no RLS layer — `auth.users` is outside PostgREST — so the guard that
 * stops it deleting a real profile is asserted here, in code: an id that
 * already has a `public.users` row must be refused (409) and
 * `deleteUser` must never be reached.
 */

interface FakeOpts {
  existing?: { id: string } | null
  lookupError?: { message: string } | null
  deleteError?: { message: string } | null
}

function fakeAdmin(opts: FakeOpts = {}) {
  const deleteUser = vi.fn(async () => ({ data: { user: null }, error: opts.deleteError ?? null }))
  const query = { table: '', select: '', eqColumn: '', eqValue: '' as unknown }
  const admin = {
    from(table: string) {
      query.table = table
      return {
        select(columns: string) {
          query.select = columns
          return {
            eq(column: string, value: unknown) {
              query.eqColumn = column
              query.eqValue = value
              return {
                maybeSingle: async () => ({
                  data: opts.existing ?? null,
                  error: opts.lookupError ?? null,
                }),
              }
            },
          }
        },
      }
    },
    auth: { admin: { deleteUser } },
  } as unknown as ServiceClient
  return { admin, deleteUser, query }
}

const PENDING_ID = 'b1000000-0000-0000-0000-000000000002'

describe('rejectRegistration (lib)', () => {
  it('rejects a missing or blank id with 400, before any GoTrue call', async () => {
    const { admin, deleteUser } = fakeAdmin()
    expect(await rejectRegistration(admin, undefined)).toMatchObject({ ok: false, status: 400 })
    expect(await rejectRegistration(admin, '   ')).toMatchObject({ ok: false, status: 400 })
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('refuses (409) when the id already has a public.users row, without calling deleteUser', async () => {
    const { admin, deleteUser, query } = fakeAdmin({ existing: { id: PENDING_ID } })
    const result = await rejectRegistration(admin, PENDING_ID)
    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(query).toMatchObject({ table: 'users', select: 'id', eqColumn: 'id', eqValue: PENDING_ID })
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('surfaces a profile-lookup failure as 500', async () => {
    const { admin, deleteUser } = fakeAdmin({ lookupError: { message: 'db down' } })
    expect(await rejectRegistration(admin, PENDING_ID)).toEqual({
      ok: false,
      status: 500,
      error: 'db down',
    })
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('surfaces a GoTrue deleteUser error as 400', async () => {
    const { admin } = fakeAdmin({ deleteError: { message: 'User not found' } })
    expect(await rejectRegistration(admin, PENDING_ID)).toEqual({
      ok: false,
      status: 400,
      error: 'User not found',
    })
  })

  it('deletes the pending auth.users row and returns the id on success', async () => {
    const { admin, deleteUser } = fakeAdmin({ existing: null })
    expect(await rejectRegistration(admin, PENDING_ID)).toEqual({ ok: true, id: PENDING_ID })
    expect(deleteUser).toHaveBeenCalledTimes(1)
    expect(deleteUser).toHaveBeenCalledWith(PENDING_ID)
  })
})

// ---- the src/features/admin/api.ts client method ----

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { auth: { getSession: vi.fn() } },
}))
vi.mock('../../src/lib/supabase', () => ({ supabase: supabaseMock }))

const { rejectRegistration: rejectRegistrationApi } = await import('../../src/features/admin/api')

describe('rejectRegistration (admin api)', () => {
  beforeEach(() => {
    supabaseMock.auth.getSession.mockReset()
    vi.unstubAllGlobals()
  })

  it('POSTs the id with a bearer token and resolves on 2xx', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: PENDING_ID }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(rejectRegistrationApi(PENDING_ID)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      '/.netlify/functions/reject-registration',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        body: JSON.stringify({ id: PENDING_ID }),
      }),
    )
  })

  it('throws the Function error body on a non-OK status', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'already registered' }), { status: 409 })),
    )
    await expect(rejectRegistrationApi(PENDING_ID)).rejects.toThrow('already registered')
  })

  it('throws when there is no session', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } })
    await expect(rejectRegistrationApi(PENDING_ID)).rejects.toThrow('Not signed in')
  })
})
