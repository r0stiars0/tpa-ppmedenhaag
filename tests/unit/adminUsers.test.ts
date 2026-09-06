import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The three client calls behind `/admin/users` (TAD ADR-042). The write
 * path is a `security definer` RPC — the guards (last admin, self,
 * tutor_ids cleanup) and the audit row are proven in the pgTAP RLS suite
 * — so what is worth pinning here is the client shape: the directory
 * query orders by name, and the impact/update RPCs are called with the
 * exact argument names the function signatures expect, with the impact
 * result mapped to a camelCase shape the page can branch on.
 */
const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn(), rpc: vi.fn() },
}))
vi.mock('../../src/lib/supabase', () => ({ supabase: supabaseMock }))

const { fetchAllUsers, fetchUserRoleImpact, updateUser } = await import(
  '../../src/features/admin/api'
)

/** `.from(t).select(cols).order(col)` resolves to the queued `{ data, error }`. */
function queueFrom(result: { data: unknown; error?: unknown }) {
  const call: { table: string; select: string; order?: string } = { table: '', select: '' }
  supabaseMock.from.mockImplementation((table: string) => {
    call.table = table
    const builder: Record<string, unknown> = {
      select(columns: string) {
        call.select = columns
        return builder
      },
      order(column: string) {
        call.order = column
        return Promise.resolve({ error: null, ...result })
      },
    }
    return builder
  })
  return call
}

beforeEach(() => {
  supabaseMock.from.mockReset()
  supabaseMock.rpc.mockReset()
})

describe('fetchAllUsers', () => {
  it('selects the directory columns ordered by name', async () => {
    const call = queueFrom({
      data: [{ id: 'u1', full_name: 'Aisyah', email: 'a@x.nl', role: 'parent' }],
    })

    const rows = await fetchAllUsers()

    expect(call).toEqual({
      table: 'users',
      select: 'id, full_name, email, role',
      order: 'full_name',
    })
    expect(rows).toEqual([{ id: 'u1', full_name: 'Aisyah', email: 'a@x.nl', role: 'parent' }])
  })

  it('returns [] when the table is empty', async () => {
    queueFrom({ data: null })
    await expect(fetchAllUsers()).resolves.toEqual([])
  })

  it('rethrows a query error', async () => {
    queueFrom({ data: null, error: { message: 'boom' } })
    await expect(fetchAllUsers()).rejects.toBeTruthy()
  })
})

describe('fetchUserRoleImpact', () => {
  it('calls the RPC with p_user / p_new_role and maps the row to camelCase', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        {
          tutor_groups: ['Grup A', 'Grup B'],
          guardian_children: ['Yusuf'],
          linked_student: 'Salma',
          would_block: null,
        },
      ],
      error: null,
    })

    const impact = await fetchUserRoleImpact('u1', 'parent')

    expect(supabaseMock.rpc).toHaveBeenCalledWith('fn_admin_user_role_impact', {
      p_user: 'u1',
      p_new_role: 'parent',
    })
    expect(impact).toEqual({
      tutorGroups: ['Grup A', 'Grup B'],
      guardianChildren: ['Yusuf'],
      linkedStudent: 'Salma',
      wouldBlock: null,
    })
  })

  it('defaults every field when the RPC returns no row', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: [], error: null })

    await expect(fetchUserRoleImpact('u1', 'tutor')).resolves.toEqual({
      tutorGroups: [],
      guardianChildren: [],
      linkedStudent: null,
      wouldBlock: null,
    })
  })

  it('passes through a would_block value', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [{ tutor_groups: null, guardian_children: null, linked_student: null, would_block: 'last_admin' }],
      error: null,
    })
    await expect(fetchUserRoleImpact('u1', 'tutor')).resolves.toMatchObject({
      wouldBlock: 'last_admin',
    })
  })

  it('rethrows an RPC error', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'nope' } })
    await expect(fetchUserRoleImpact('u1', 'tutor')).rejects.toBeTruthy()
  })
})

describe('updateUser', () => {
  it('calls fn_admin_update_user with the trimmed name and role', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: null })

    await updateUser({ id: 'u1', full_name: 'Nadia Putri', role: 'tutor' })

    expect(supabaseMock.rpc).toHaveBeenCalledWith('fn_admin_update_user', {
      p_user: 'u1',
      p_full_name: 'Nadia Putri',
      p_new_role: 'tutor',
    })
  })

  it('rethrows the RPC error (last-admin / self / 42501 all arrive this way)', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'at least one admin must remain' } })
    await expect(updateUser({ id: 'u1', full_name: 'X', role: 'parent' })).rejects.toBeTruthy()
  })
})
