import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceClient } from '../../netlify/functions/lib/callerAuth'
import { deleteRegisteredUser } from '../../netlify/functions/lib/deleteUser'

/**
 * Deleting a registered `parent` / `student` account (TAD ADR-043) — for
 * cleaning up a bogus account a malicious enrolment-form submission
 * created. No RLS layer (`auth.users` is not PostgREST-reachable), so
 * every guard is asserted here: own account, deletable role, and the
 * `student_guardians.user_id` ON DELETE RESTRICT that a guardian link —
 * active or historical — puts in front of the delete.
 */

const CALLER = 'ad000000-0000-0000-0000-000000000000'
const TARGET = 'b1000000-0000-0000-0000-000000000009'

interface FakeOpts {
  profile?: { role: string } | null
  profileError?: { message: string } | null
  guardianLinkCount?: number
  guardianLinkError?: { message: string } | null
  deleteError?: { message: string } | null
}

function fakeAdmin(opts: FakeOpts = {}) {
  const deleteUser = vi.fn(async () => ({ data: { user: null }, error: opts.deleteError ?? null }))
  const admin = {
    from(table: string) {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.profile === undefined ? { role: 'parent' } : opts.profile,
                error: opts.profileError ?? null,
              }),
            }),
          }),
        }
      }
      // student_guardians — a `head: true` count query
      return {
        select: () => ({
          eq: async () => ({ count: opts.guardianLinkCount ?? 0, error: opts.guardianLinkError ?? null }),
        }),
      }
    },
    auth: { admin: { deleteUser } },
  } as unknown as ServiceClient
  return { admin, deleteUser }
}

describe('deleteRegisteredUser', () => {
  it('rejects a missing / blank id with 400', async () => {
    const { admin, deleteUser } = fakeAdmin()
    expect(await deleteRegisteredUser(admin, CALLER, undefined)).toMatchObject({ ok: false, status: 400 })
    expect(await deleteRegisteredUser(admin, CALLER, '  ')).toMatchObject({ ok: false, status: 400 })
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('refuses the caller deleting their own account (403)', async () => {
    const { admin, deleteUser } = fakeAdmin()
    expect(await deleteRegisteredUser(admin, CALLER, CALLER)).toMatchObject({ ok: false, status: 403 })
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('refuses an id with no profile (409 — a pending sign-in goes through Registrations)', async () => {
    const { admin, deleteUser } = fakeAdmin({ profile: null })
    expect(await deleteRegisteredUser(admin, CALLER, TARGET)).toMatchObject({ ok: false, status: 409 })
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('refuses a tutor and an admin account (403), never reaching deleteUser', async () => {
    for (const role of ['tutor', 'admin']) {
      const { admin, deleteUser } = fakeAdmin({ profile: { role } })
      expect(await deleteRegisteredUser(admin, CALLER, TARGET)).toMatchObject({ ok: false, status: 403 })
      expect(deleteUser).not.toHaveBeenCalled()
    }
  })

  it('refuses an account that still has a student_guardians link (409)', async () => {
    const { admin, deleteUser } = fakeAdmin({ profile: { role: 'parent' }, guardianLinkCount: 1 })
    const res = await deleteRegisteredUser(admin, CALLER, TARGET)
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('surfaces a lookup / count failure as 500', async () => {
    expect(
      await deleteRegisteredUser(fakeAdmin({ profileError: { message: 'db down' } }).admin, CALLER, TARGET),
    ).toMatchObject({ ok: false, status: 500 })
    expect(
      await deleteRegisteredUser(
        fakeAdmin({ profile: { role: 'parent' }, guardianLinkError: { message: 'db down' } }).admin,
        CALLER,
        TARGET,
      ),
    ).toMatchObject({ ok: false, status: 500 })
  })

  it('deletes a parent with no guardian links and returns the id', async () => {
    const { admin, deleteUser } = fakeAdmin({ profile: { role: 'parent' }, guardianLinkCount: 0 })
    expect(await deleteRegisteredUser(admin, CALLER, TARGET)).toEqual({ ok: true, id: TARGET })
    expect(deleteUser).toHaveBeenCalledWith(TARGET)
  })

  it('deletes a junk 16+ student self-login too', async () => {
    const { admin, deleteUser } = fakeAdmin({ profile: { role: 'student' }, guardianLinkCount: 0 })
    expect(await deleteRegisteredUser(admin, CALLER, TARGET)).toEqual({ ok: true, id: TARGET })
    expect(deleteUser).toHaveBeenCalledTimes(1)
  })

  it('surfaces a GoTrue deleteUser error as 400', async () => {
    const { admin } = fakeAdmin({ profile: { role: 'parent' }, deleteError: { message: 'nope' } })
    expect(await deleteRegisteredUser(admin, CALLER, TARGET)).toEqual({ ok: false, status: 400, error: 'nope' })
  })
})

// ---- the src/features/admin/api.ts client method ----

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { auth: { getSession: vi.fn() } },
}))
vi.mock('../../src/lib/supabase', () => ({ supabase: supabaseMock }))

const { deleteUser: deleteUserApi } = await import('../../src/features/admin/api')

describe('deleteUser (admin api)', () => {
  beforeEach(() => {
    supabaseMock.auth.getSession.mockReset()
    vi.unstubAllGlobals()
  })

  it('POSTs the id with a bearer token and resolves on 2xx', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: TARGET }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(deleteUserApi(TARGET)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      '/.netlify/functions/delete-user',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        body: JSON.stringify({ id: TARGET }),
      }),
    )
  })

  it('throws the Function error body on a non-OK status', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'still guards students' }), { status: 409 })),
    )
    await expect(deleteUserApi(TARGET)).rejects.toThrow('still guards students')
  })

  it('throws when there is no session', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } })
    await expect(deleteUserApi(TARGET)).rejects.toThrow('Not signed in')
  })
})
