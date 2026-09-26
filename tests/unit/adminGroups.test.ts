import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The admin data-layer calls for multi-group enrolment (PRD Feature 8
 * release 8a, TAD ADR-045). The access rules behind them — admin-only
 * enrolment, the archive freeze, the audit log — are proven in the
 * pgTAP suite (RLS-122…142); what is pinned here is the client shape
 * each screen relies on.
 */
const { supabaseMock, calls } = vi.hoisted(() => {
  const calls: { table?: string; rpc?: string; chain: [string, unknown[]][] }[] = []
  // A chain recorder: every builder method records itself and returns the
  // same proxy; awaiting it resolves to `{ data: null, error: null }`.
  function recorder(entry: (typeof calls)[number]) {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => resolve({ data: [], error: null })
          }
          return (...args: unknown[]) => {
            entry.chain.push([prop, args])
            return proxy
          }
        },
      },
    )
    return proxy
  }
  const supabaseMock = {
    from: vi.fn((table: string) => {
      const entry = { table, chain: [] as [string, unknown[]][] }
      calls.push(entry)
      return recorder(entry)
    }),
    rpc: vi.fn((name: string, args: unknown) => {
      const entry = { rpc: name, chain: [['args', [args]]] as [string, unknown[]][] }
      calls.push(entry)
      return recorder(entry)
    }),
  }
  return { supabaseMock, calls }
})
vi.mock('../../src/lib/supabase', () => ({ supabase: supabaseMock }))

const api = await import('../../src/features/admin/api')

beforeEach(() => {
  calls.length = 0
})

describe('saveStudent — the group set', () => {
  it('sends the chosen groups as p_class_ids and never the legacy single group', async () => {
    await api.saveStudent({
      full_name: 'Ali',
      date_of_birth: '2016-01-01',
      class_ids: ['yb', 'aq'],
      user_id: null,
      guardians: [{ user_id: 'p1', relation: null }],
    })
    const args = calls[0].chain[0][1][0] as Record<string, unknown>
    expect(calls[0].rpc).toBe('fn_admin_save_student')
    expect(args.p_class_ids).toEqual(['yb', 'aq'])
    expect(args).not.toHaveProperty('p_class_id')
  })

  it('sends an empty set as an empty array, which removes every active membership', async () => {
    await api.saveStudent({
      full_name: 'Ali',
      date_of_birth: '2016-01-01',
      class_ids: [],
      user_id: null,
      guardians: [{ user_id: 'p1', relation: null }],
    })
    expect((calls[0].chain[0][1][0] as Record<string, unknown>).p_class_ids).toEqual([])
  })
})

describe('bulk enrolment (PRD FR-009)', () => {
  it('adds members with one upsert that ignores students already in the group', async () => {
    await api.addClassMembers('aq', ['s1', 's2'])
    expect(calls[0].table).toBe('class_members')
    expect(calls[0].chain[0]).toEqual([
      'upsert',
      [
        [
          { class_id: 'aq', student_id: 's1' },
          { class_id: 'aq', student_id: 's2' },
        ],
        { onConflict: 'class_id,student_id', ignoreDuplicates: true },
      ],
    ])
  })

  it('adds nothing, and makes no call, for an empty selection', async () => {
    await api.addClassMembers('aq', [])
    expect(calls).toEqual([])
  })

  it('removes members of one group only', async () => {
    await api.removeClassMembers('aq', ['s1'])
    expect(calls[0].table).toBe('class_members')
    expect(calls[0].chain).toEqual([
      ['delete', []],
      ['eq', ['class_id', 'aq']],
      ['in', ['student_id', ['s1']]],
    ])
  })
})

describe('archiving (PRD FR-010)', () => {
  it('archives by stamping archived_at', async () => {
    await api.setClassArchived('yb', true)
    const [method, [patch]] = calls[0].chain[0] as [string, [Record<string, unknown>]]
    expect(method).toBe('update')
    expect(typeof patch.archived_at).toBe('string')
    expect(calls[0].chain[1]).toEqual(['eq', ['id', 'yb']])
  })

  it('unarchives by clearing it', async () => {
    await api.setClassArchived('yb', false)
    expect(calls[0].chain[0]).toEqual(['update', [{ archived_at: null }]])
  })
})

describe('Murajaah targets (PRD FR-001)', () => {
  it('closes the chosen targets by setting active = false', async () => {
    await api.closeMurajaahTargets(['t1', 't2'])
    expect(calls[0].table).toBe('murajaah_assignments')
    expect(calls[0].chain).toEqual([
      ['update', [{ active: false }]],
      ['in', ['id', ['t1', 't2']]],
    ])
  })

  it('makes no call when there is nothing to close', async () => {
    await api.closeMurajaahTargets([])
    expect(calls).toEqual([])
  })
})
