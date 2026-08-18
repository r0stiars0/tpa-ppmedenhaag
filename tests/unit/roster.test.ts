import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The class roster every recording screen is built on.
 *
 * Small, and worth pinning precisely because of who reads it since
 * ADR-019: a tutor-parent's `students` grant is the union of their class
 * and their own children (pgTAP RLS-28), so a roster query that leaned on
 * RLS to scope itself would put their own child — enrolled in someone
 * else's class — into the register they are marking. The `class_id`
 * filter is what keeps the two apart, and RLS remains the thing that
 * guarantees no answer can include a class that is not theirs.
 */
const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }))

vi.mock('../../src/lib/supabase', () => ({ supabase: supabaseMock }))

const { fetchClassRoster, fetchRecordableRoster, isRecordableStudent, recordableStudents } =
  await import('../../src/lib/roster')

const KELAS_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function stubQuery(rows: unknown[], error: unknown = null) {
  const calls: { table?: string; select?: string; eqColumn?: string; eqValue?: unknown; order?: string } =
    {}
  supabaseMock.from.mockImplementation((table: string) => {
    calls.table = table
    return {
      select(columns: string) {
        calls.select = columns
        return {
          eq(column: string, value: unknown) {
            calls.eqColumn = column
            calls.eqValue = value
            return {
              order(column: string) {
                calls.order = column
                return Promise.resolve({ data: error ? null : rows, error })
              },
            }
          },
        }
      },
    }
  })
  return calls
}

beforeEach(() => supabaseMock.from.mockReset())

describe('fetchClassRoster', () => {
  it('asks for one class by id, ordered by name', () => {
    const calls = stubQuery([{ id: 's1', full_name: 'Ali' }])
    return fetchClassRoster(KELAS_A).then((rows) => {
      expect(calls.table).toBe('students')
      // Names only. A register does not need a date of birth or a
      // parent's id, and what a screen loads is part of data
      // minimisation, not only what it displays.
      expect(calls.select).toBe('id, full_name')
      expect(calls.eqColumn).toBe('class_id')
      expect(calls.eqValue).toBe(KELAS_A)
      expect(calls.order).toBe('full_name')
      expect(rows).toEqual([{ id: 's1', full_name: 'Ali' }])
    })
  })

  it('returns an empty roster rather than null for a class with nobody in it', () => {
    stubQuery([])
    return expect(fetchClassRoster(KELAS_A)).resolves.toEqual([])
  })

  it('throws rather than rendering an empty register', () => {
    // An empty register is something a tutor would mark and save. A
    // failed load has to look like a failure.
    stubQuery([], { message: 'permission denied' })
    return expect(fetchClassRoster(KELAS_A)).rejects.toMatchObject({
      message: 'permission denied',
    })
  })
})

/**
 * ADR-023(c), reached from the product for the first time.
 *
 * A 16+ santri who assists the class she is enrolled in has her own
 * record inside her own tutor grant. Migration 013 refuses the
 * evaluative writes against it, and until ADR-025 no screen took her to
 * a roster at all — so the refusal was never seen. Routing her to the
 * class scope without this filter would put her own name on five
 * recording screens where every save comes back 403.
 */
const AISYAH = 'a5000000-0000-0000-0000-000000000008'
const CLASSMATE = 'a5000000-0000-0000-0000-000000000001'
const OWN_CHILD = 'a5000000-0000-0000-0000-000000000006'

describe('recordableStudents — the app-side mirror of fn_my_recordable_students()', () => {
  it('subtracts the caller’s own record and nothing else', () => {
    const roster = [{ id: CLASSMATE }, { id: AISYAH }, { id: OWN_CHILD }]
    expect(recordableStudents(roster, AISYAH)).toEqual([{ id: CLASSMATE }, { id: OWN_CHILD }])
  })

  it('never subtracts a tutor-parent’s own child (ADR-024)', () => {
    // The rule the two cases must not be collapsed into one. A tutor
    // who teaches the class her own child attends may record for that
    // child and write her year-end report — PPME's decision, and the
    // thing a "tidy up" of this predicate would quietly reverse on
    // screens where no RLS test would catch it. Bapak Hasan holds no
    // `students` record of his own, so his `selfStudentId` is null and
    // his daughter stays on every roster he opens.
    const roster = [{ id: CLASSMATE }, { id: OWN_CHILD }]
    expect(recordableStudents(roster, null)).toEqual(roster)
  })

  it('is a no-op for every account that is not also a santri', () => {
    // Which is every account in the TPA but one. `selfStudentId` is
    // null for them, so the register they see is byte-identical to the
    // one they saw before this PR.
    const roster = [{ id: CLASSMATE }, { id: OWN_CHILD }]
    expect(recordableStudents(roster, null)).toEqual(roster)
    expect(isRecordableStudent(CLASSMATE, null)).toBe(true)
    expect(isRecordableStudent(OWN_CHILD, null)).toBe(true)
  })

  it('answers the single-row question the register renders from', () => {
    expect(isRecordableStudent(AISYAH, AISYAH)).toBe(false)
    expect(isRecordableStudent(CLASSMATE, AISYAH)).toBe(true)
    expect(isRecordableStudent(OWN_CHILD, AISYAH)).toBe(true)
  })

  it('leaves an empty roster empty rather than throwing on a null self id', () => {
    expect(recordableStudents([], null)).toEqual([])
    expect(recordableStudents([], AISYAH)).toEqual([])
  })
})

describe('fetchRecordableRoster — the query the five recording screens make', () => {
  it('filters the fetched roster by the same predicate', () => {
    stubQuery([
      { id: CLASSMATE, full_name: 'Ali' },
      { id: AISYAH, full_name: 'Aisyah' },
    ])
    return expect(fetchRecordableRoster('kelas-a', AISYAH)).resolves.toEqual([
      { id: CLASSMATE, full_name: 'Ali' },
    ])
  })

  it('returns the whole class when the caller has no record of their own', () => {
    const rows = [
      { id: CLASSMATE, full_name: 'Ali' },
      { id: OWN_CHILD, full_name: 'Khadijah' },
    ]
    stubQuery(rows)
    return expect(fetchRecordableRoster('kelas-a', null)).resolves.toEqual(rows)
  })

  it('propagates a failed load rather than reporting a short roster', () => {
    stubQuery([], { message: 'permission denied' })
    return expect(fetchRecordableRoster('kelas-a', AISYAH)).rejects.toMatchObject({
      message: 'permission denied',
    })
  })
})
