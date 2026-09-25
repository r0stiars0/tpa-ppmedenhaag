import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A child's attendance across all their groups (PRD Feature 8 FR-003 /
 * FR-006, TAD ADR-045(d)). The reason-withholding rule lives in
 * `fn_student_attendance_history` and is proven in pgTAP (RLS-127); what
 * is pinned here is that the screens go through that function — never
 * the `attendance` table, whose tutor policy is scoped to one group — and
 * how its rows are shaped.
 */
const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('../../src/lib/supabase', () => ({ supabase: supabaseMock }))

const { fetchAttendanceHistory, fetchStudentGroups } = await import('../../src/features/attendance/api')

beforeEach(() => {
  supabaseMock.from.mockReset()
  supabaseMock.rpc.mockReset()
})

describe('fetchAttendanceHistory', () => {
  it('reads through fn_student_attendance_history and keeps the group on every row', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        { session_id: 's2', session_date: '2026-09-19', class_id: 'aq', class_name: 'Aqidah', status: 'absent', reason: null },
        { session_id: 's1', session_date: '2026-09-12', class_id: 'yb', class_name: 'Kelas A', status: 'present', reason: null },
      ],
      error: null,
    })
    const rows = await fetchAttendanceHistory('child-1')
    expect(supabaseMock.rpc).toHaveBeenCalledWith('fn_student_attendance_history', { p_student: 'child-1' })
    expect(supabaseMock.from).not.toHaveBeenCalled()
    expect(rows).toEqual([
      { id: 's2', date: '2026-09-19', classId: 'aq', className: 'Aqidah', status: 'absent', reason: null },
      { id: 's1', date: '2026-09-12', classId: 'yb', className: 'Kelas A', status: 'present', reason: null },
    ])
  })

  it('returns an empty history for zero rows (the function answers a stranger with none)', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: [], error: null })
    await expect(fetchAttendanceHistory('child-1')).resolves.toEqual([])
  })

  it('throws a failed load rather than showing an empty history', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(fetchAttendanceHistory('child-1')).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('fetchStudentGroups', () => {
  it("lists the child's active groups with their meeting days, by name", async () => {
    const calls: [string, unknown[]][] = []
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is']) {
      builder[method] = (...args: unknown[]) => {
        calls.push([method, args])
        return builder
      }
    }
    builder.then = (resolve: (v: unknown) => void) =>
      resolve({
        data: [
          { class: { id: 'yb', name: 'Kelas A', meeting_days: [6], schedule: '10:00', tracks_progress: true } },
          { class: { id: 'aq', name: 'Aqidah', meeting_days: [0], schedule: null, tracks_progress: false } },
        ],
        error: null,
      })
    supabaseMock.from.mockReturnValue(builder)
    const groups = await fetchStudentGroups('child-1')
    expect(supabaseMock.from).toHaveBeenCalledWith('class_members')
    expect(calls).toContainEqual(['eq', ['student_id', 'child-1']])
    expect(calls).toContainEqual(['is', ['class.archived_at', null]])
    expect(groups.map((g) => g.name)).toEqual(['Aqidah', 'Kelas A'])
  })
})
