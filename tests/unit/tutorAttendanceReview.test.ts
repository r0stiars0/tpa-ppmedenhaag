import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The two read queries behind `/admin/tutor-attendance` (TAD ADR-041
 * part 2). Both lean on the admin's existing grants — no new policy — so
 * what is worth pinning is the client-side shape: the picker is driven
 * by *recorded* rows (not a raw tutor list), and the history stitches in
 * the session date and group name and sorts newest-first, the
 * `fetchAttendanceHistory` contract.
 */
const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }))
vi.mock('../../src/lib/supabase', () => ({ supabase: supabaseMock }))

const { fetchReviewableTutors, fetchTutorAttendanceHistory } = await import(
  '../../src/features/attendance/api'
)

/**
 * Minimal PostgREST-builder fake: every terminal (`select` alone, or
 * `.eq(...)`, or `.in(...)`) resolves to the next queued `{ data, error }`
 * and the chain is also awaitable directly.
 */
function queueResults(...results: { data: unknown; error?: unknown }[]) {
  const calls: { table: string; select: string; eq?: [string, unknown]; in?: [string, unknown] }[] = []
  let i = 0
  supabaseMock.from.mockImplementation((table: string) => {
    const call: (typeof calls)[number] = { table, select: '' }
    calls.push(call)
    const result = () => Promise.resolve({ error: null, ...results[i++] })
    const builder: Record<string, unknown> = {
      select(columns: string) {
        call.select = columns
        return builder
      },
      eq(column: string, value: unknown) {
        call.eq = [column, value]
        return result()
      },
      in(column: string, value: unknown) {
        call.in = [column, value]
        return result()
      },
      then(onFulfilled: (v: unknown) => unknown) {
        return result().then(onFulfilled)
      },
    }
    return builder
  })
  return calls
}

beforeEach(() => supabaseMock.from.mockReset())

describe('fetchReviewableTutors', () => {
  it('dedupes by tutor_id, keeps the name, and sorts by name', async () => {
    const calls = queueResults({
      data: [
        { tutor_id: 'u-zed', tutor: { full_name: 'Zaid' } },
        { tutor_id: 'u-ali', tutor: { full_name: 'Ali' } },
        { tutor_id: 'u-zed', tutor: { full_name: 'Zaid' } },
      ],
    })

    const rows = await fetchReviewableTutors()

    expect(calls[0].table).toBe('tutor_attendance')
    expect(calls[0].select).toContain('tutor_id')
    expect(rows).toEqual([
      { user_id: 'u-ali', full_name: 'Ali' },
      { user_id: 'u-zed', full_name: 'Zaid' },
    ])
  })

  it('returns an empty list when nothing has been recorded', async () => {
    queueResults({ data: [] })
    await expect(fetchReviewableTutors()).resolves.toEqual([])
  })

  it('rethrows a query error rather than reporting an empty roster', async () => {
    queueResults({ data: null, error: { message: 'boom' } })
    await expect(fetchReviewableTutors()).rejects.toBeTruthy()
  })
})

describe('fetchTutorAttendanceHistory', () => {
  it('filters by tutor_id, stitches in the session date + group name, newest first', async () => {
    const calls = queueResults(
      {
        data: [
          { id: 'r1', status: 'present', reason: null, session_id: 's1' },
          { id: 'r2', status: 'absent', reason: 'ziek', session_id: 's2' },
        ],
      },
      {
        data: [
          { id: 's1', date: '2026-01-10', class: { name: 'Grup A' } },
          { id: 's2', date: '2026-02-20', class: { name: 'Grup B' } },
        ],
      },
    )

    const rows = await fetchTutorAttendanceHistory('u-ali')

    expect(calls[0]).toMatchObject({ table: 'tutor_attendance', eq: ['tutor_id', 'u-ali'] })
    expect(calls[1]).toMatchObject({ table: 'sessions', in: ['id', ['s1', 's2']] })
    expect(rows).toEqual([
      { id: 'r2', status: 'absent', reason: 'ziek', date: '2026-02-20', className: 'Grup B' },
      { id: 'r1', status: 'present', reason: null, date: '2026-01-10', className: 'Grup A' },
    ])
  })

  it('returns [] without a second query when the tutor has no rows', async () => {
    const calls = queueResults({ data: [] })
    await expect(fetchTutorAttendanceHistory('u-ali')).resolves.toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('rethrows a sessions-query error', async () => {
    queueResults(
      { data: [{ id: 'r1', status: 'present', reason: null, session_id: 's1' }] },
      { data: null, error: { message: 'boom' } },
    )
    await expect(fetchTutorAttendanceHistory('u-ali')).rejects.toBeTruthy()
  })
})
