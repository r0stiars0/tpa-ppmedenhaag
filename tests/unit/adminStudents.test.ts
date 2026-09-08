import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `deleteStudent` — the client call behind the "Hapus" action on
 * `/admin/students` (TAD ADR-043). The RLS backing (admin-only, cascade)
 * is proven in the pgTAP suite; what is worth pinning here is the client
 * shape: a plain `delete().eq('id', …)` on `students`, and that a query
 * error is rethrown.
 */
const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn(), rpc: vi.fn() },
}))
vi.mock('../../src/lib/supabase', () => ({ supabase: supabaseMock }))

const { deleteStudent } = await import('../../src/features/admin/api')

beforeEach(() => {
  supabaseMock.from.mockReset()
})

function queueDelete(result: { error: unknown }) {
  const call: { table: string; eqColumn: string; eqValue: unknown } = {
    table: '',
    eqColumn: '',
    eqValue: undefined,
  }
  supabaseMock.from.mockImplementation((table: string) => {
    call.table = table
    return {
      delete: () => ({
        eq: (column: string, value: unknown) => {
          call.eqColumn = column
          call.eqValue = value
          return Promise.resolve(result)
        },
      }),
    }
  })
  return call
}

describe('deleteStudent', () => {
  it('deletes the students row by id', async () => {
    const call = queueDelete({ error: null })
    await deleteStudent('stu-1')
    expect(call).toEqual({ table: 'students', eqColumn: 'id', eqValue: 'stu-1' })
  })

  it('rethrows a query error', async () => {
    queueDelete({ error: { message: 'permission denied' } })
    await expect(deleteStudent('stu-1')).rejects.toMatchObject({ message: 'permission denied' })
  })
})
