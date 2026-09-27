import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The reads behind the attendance graphs (TAD ADR-046). Both lean on
 * grants the caller already holds — no new policy — so what is pinned
 * here is the query shape and the mapping: the tile asks for one group's
 * sessions with their statuses, and the admin overview asks for one date
 * range across every group, marking a session "held" only when anything
 * was recorded against it.
 */
const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('../../src/lib/supabase', () => ({ supabase: supabaseMock }))

const { fetchGroupSessionStats, fetchTutorOverviewData } = await import('../../src/features/attendance/api')

type Call = { table: string; select: string; filters: [string, ...unknown[]][] }

/** A chainable PostgREST-builder fake; each `from()` resolves to the next queued result. */
function queueResults(...results: { data: unknown; error?: unknown }[]) {
  const calls: Call[] = []
  let i = 0
  supabaseMock.from.mockImplementation((table: string) => {
    const call: Call = { table, select: '', filters: [] }
    calls.push(call)
    const result = { error: null, ...results[i++] }
    const builder: Record<string, unknown> = {
      select(columns: string) {
        call.select = columns
        return builder
      },
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        return Promise.resolve(result).then(onFulfilled, onRejected)
      },
    }
    for (const name of ['eq', 'gte', 'lte', 'order', 'limit', 'in', 'is']) {
      builder[name] = (...args: unknown[]) => {
        call.filters.push([name, ...args])
        return builder
      }
    }
    return builder
  })
  return calls
}

beforeEach(() => {
  supabaseMock.from.mockReset()
  supabaseMock.rpc.mockReset()
})

describe('fetchGroupSessionStats', () => {
  it("reads one group's recent sessions with their student statuses", async () => {
    const calls = queueResults({
      data: [
        { date: '2026-09-20', attendance: [{ status: 'present' }, { status: 'absent' }] },
        { date: '2026-09-27', attendance: [] },
      ],
    })

    const rows = await fetchGroupSessionStats('class-a')

    expect(calls[0].table).toBe('sessions')
    expect(calls[0].select).toContain('attendance(status)')
    expect(calls[0].filters).toContainEqual(['eq', 'class_id', 'class-a'])
    expect(rows).toEqual([
      { date: '2026-09-20', statuses: ['present', 'absent'] },
      { date: '2026-09-27', statuses: [] },
    ])
  })

  it('rethrows a query error rather than drawing an empty tile', async () => {
    queueResults({ data: null, error: { message: 'boom' } })
    await expect(fetchGroupSessionStats('class-a')).rejects.toBeTruthy()
  })
})

describe('fetchTutorOverviewData', () => {
  it('reads the range once and marks a session held only when something was recorded', async () => {
    const calls = queueResults(
      { data: [{ id: 'A', name: 'Grup A', archived_at: null }, { id: 'B', name: 'Grup B', archived_at: '2026-06-30' }] },
      {
        data: [
          { id: 's1', class_id: 'A', date: '2026-09-20', attendance: [{ count: 12 }], tutor_attendance: [{ count: 0 }] },
          { id: 's2', class_id: 'A', date: '2026-09-27', attendance: [{ count: 0 }], tutor_attendance: [{ count: 0 }] },
          { id: 's3', class_id: 'A', date: '2026-09-13', attendance: [{ count: 0 }], tutor_attendance: [{ count: 2 }] },
        ],
      },
      {
        data: [
          { session_id: 's1', tutor_id: 'u1', status: 'absent', reason: 'Sakit', tutor: { full_name: 'Ahmad' } },
        ],
      },
    )
    supabaseMock.rpc.mockResolvedValue({ data: [{ user_id: 'u1', full_name: 'Ahmad' }], error: null })

    const data = await fetchTutorOverviewData('2026-08-01', '2026-09-27')

    expect(calls.map((c) => c.table)).toEqual(['classes', 'sessions', 'tutor_attendance'])
    expect(calls[1].filters).toEqual(
      expect.arrayContaining([
        ['gte', 'date', '2026-08-01'],
        ['lte', 'date', '2026-09-27'],
      ]),
    )
    expect(calls[2].filters).toEqual(
      expect.arrayContaining([
        ['gte', 'session.date', '2026-08-01'],
        ['lte', 'session.date', '2026-09-27'],
      ]),
    )
    // tutor lists only for the active group
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1)
    expect(supabaseMock.rpc).toHaveBeenCalledWith('fn_class_tutors', { p_class: 'A' })

    expect(data.classes).toEqual([
      { id: 'A', name: 'Grup A', archived: false },
      { id: 'B', name: 'Grup B', archived: true },
    ])
    expect(data.sessions).toEqual([
      { id: 's1', classId: 'A', date: '2026-09-20', held: true },
      { id: 's2', classId: 'A', date: '2026-09-27', held: false },
      { id: 's3', classId: 'A', date: '2026-09-13', held: true },
    ])
    expect(data.rows).toEqual([{ sessionId: 's1', tutorId: 'u1', status: 'absent', reason: 'Sakit' }])
    expect(data.names).toEqual({ u1: 'Ahmad' })
    expect(data.tutorsByClass).toEqual({ A: [{ user_id: 'u1', full_name: 'Ahmad' }] })
  })

  it('rethrows a query error', async () => {
    queueResults({ data: null, error: { message: 'boom' } }, { data: [] }, { data: [] })
    supabaseMock.rpc.mockResolvedValue({ data: [], error: null })
    await expect(fetchTutorOverviewData('2026-08-01', '2026-09-27')).rejects.toBeTruthy()
  })
})
