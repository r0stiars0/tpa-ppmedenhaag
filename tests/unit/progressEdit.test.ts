import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Editing a recorded Yanbu'a / Quran entry (TAD ADR-045).
 *
 * The database is the real gate (pgTAP RLS-117…128): who may edit, which
 * columns, and the server-written marker. What these tests pin is what
 * the app decides *before* and *after* the request — who is offered the
 * control, that only content columns are ever sent, that a refused edit
 * is never reported as saved, and how names are shown.
 */
const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn(), rpc: vi.fn() } }))

vi.mock('../../src/lib/supabase', () => ({ supabase: supabaseMock }))

const {
  canEditProgressEntry,
  isQueuedStandIn,
  authorMap,
  authorDisplay,
  editedMarker,
  fetchProgressAuthors,
  ProgressEditRefusedError,
} = await import('../../src/lib/progressEdit')
const { updateYanbuaProgress } = await import('../../src/features/yanbua/api')
const { updateQuranProgress } = await import('../../src/features/quran/api')

const T1 = '70000000-0000-4000-8000-000000000001'
const T2 = '70000000-0000-4000-8000-000000000002'
const ADMIN = 'a0000000-0000-4000-8000-000000000000'
const REF = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  tutor_id: T1,
  client_ref: REF,
  edited_at: null,
  edited_by: null,
  ...over,
})

beforeEach(() => {
  supabaseMock.from.mockReset()
  supabaseMock.rpc.mockReset()
})

describe('canEditProgressEntry', () => {
  it('is true for the tutor who recorded it', () => {
    expect(canEditProgressEntry(entry(), T1, false)).toBe(true)
  })
  it('is true for an admin, whoever recorded it', () => {
    expect(canEditProgressEntry(entry(), ADMIN, true)).toBe(true)
  })
  it('is false for another tutor, a parent and a student', () => {
    expect(canEditProgressEntry(entry(), T2, false)).toBe(false)
  })
  it('is false while the entry is still an offline-queued stand-in', () => {
    const standIn = entry({ id: REF })
    expect(isQueuedStandIn(standIn)).toBe(true)
    expect(canEditProgressEntry(standIn, T1, false)).toBe(false)
    expect(canEditProgressEntry(standIn, ADMIN, true)).toBe(false)
  })
  it('treats a saved row as saved even though it carries a client_ref', () => {
    expect(isQueuedStandIn(entry())).toBe(false)
  })
  it('is false without a signed-in viewer', () => {
    expect(canEditProgressEntry(entry(), null, false)).toBe(false)
  })
})

describe('names', () => {
  const ASSIST = '50000000-0000-4000-8000-000000000005'
  const authors = authorMap([
    { user_id: T1, full_name: 'Ustadzah Aminah', is_assistant: false },
    { user_id: ADMIN, full_name: 'Admin Test', is_assistant: false },
    // What a family gets for a student assistant (migration 033): the flag, no name.
    { user_id: ASSIST, full_name: null, is_assistant: true },
  ])
  it('resolves a recorder by name', () => {
    expect(authorDisplay(T1, authors)).toEqual({ kind: 'name', name: 'Ustadzah Aminah' })
  })
  it('shows a student assistant as an assistant, never by name, when the name is withheld', () => {
    expect(authorDisplay(ASSIST, authors)).toEqual({ kind: 'assistant' })
  })
  it('still names an assistant for staff, who get the name', () => {
    const staff = authorMap([{ user_id: ASSIST, full_name: 'Aisyah', is_assistant: true }])
    expect(authorDisplay(ASSIST, staff)).toEqual({ kind: 'name', name: 'Aisyah' })
  })
  it('is unknown — not a uuid, not blank — for a person that cannot be resolved', () => {
    expect(authorDisplay(T2, authors)).toEqual({ kind: 'unknown' })
    expect(authorDisplay(null, authors)).toEqual({ kind: 'unknown' })
  })
})

describe('editedMarker', () => {
  it('is null for an entry never edited', () => {
    expect(editedMarker(entry())).toBeNull()
  })
  it('carries the editor and time of the last edit', () => {
    expect(editedMarker(entry({ edited_at: '2026-11-18T10:00:00Z', edited_by: ADMIN }))).toEqual({
      editorId: ADMIN,
      at: '2026-11-18T10:00:00Z',
    })
  })
  it('still shows an edit whose editor account has since been deleted', () => {
    expect(editedMarker(entry({ edited_at: '2026-11-18T10:00:00Z', edited_by: null }))).toEqual({
      editorId: null,
      at: '2026-11-18T10:00:00Z',
    })
  })
})

describe('fetchProgressAuthors', () => {
  it('asks the names-only function for the student and returns a lookup', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: [{ user_id: T1, full_name: 'Aminah', is_assistant: false }], error: null })
    const map = await fetchProgressAuthors('stu-1')
    expect(supabaseMock.rpc).toHaveBeenCalledWith('fn_progress_authors', { p_student: 'stu-1' })
    expect(authorDisplay(T1, map)).toEqual({ kind: 'name', name: 'Aminah' })
  })
  it('throws on an error', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: new Error('boom') })
    await expect(fetchProgressAuthors('stu-1')).rejects.toThrow('boom')
  })
})

function stubUpdate(result: { data: unknown; error: unknown }) {
  const calls: { table?: string; patch?: Record<string, unknown>; eq?: [string, unknown] } = {}
  supabaseMock.from.mockImplementation((table: string) => {
    calls.table = table
    return {
      update(patch: Record<string, unknown>) {
        calls.patch = patch
        return {
          eq(column: string, value: unknown) {
            calls.eq = [column, value]
            return { select: () => ({ maybeSingle: () => Promise.resolve(result) }) }
          },
        }
      },
    }
  })
  return calls
}

describe('updateYanbuaProgress', () => {
  it('sends only the four content columns, keyed by id', async () => {
    const calls = stubUpdate({ data: { id: 'e1', page: 16 }, error: null })
    // Extra keys a careless caller might pass must never reach the request.
    const patch = {
      jilid: 3,
      page: 16,
      mastery: 'lancar',
      notes: null,
      student_id: 'x',
      tutor_id: 'x',
      recorded_at: 'x',
      edited_by: 'x',
    } as never
    await updateYanbuaProgress('e1', patch)
    expect(calls.table).toBe('yanbua_progress')
    expect(Object.keys(calls.patch!).sort()).toEqual(['jilid', 'mastery', 'notes', 'page'])
    expect(calls.eq).toEqual(['id', 'e1'])
  })
  it('reports a zero-row result as a refused edit, not as success', async () => {
    stubUpdate({ data: null, error: null })
    await expect(
      updateYanbuaProgress('e1', { jilid: 3, page: 16, mastery: 'lancar', notes: null }),
    ).rejects.toBeInstanceOf(ProgressEditRefusedError)
  })
  it('rethrows a database error', async () => {
    stubUpdate({ data: null, error: new Error('db') })
    await expect(
      updateYanbuaProgress('e1', { jilid: 3, page: 16, mastery: 'lancar', notes: null }),
    ).rejects.toThrow('db')
  })
})

describe('updateQuranProgress', () => {
  const patch = { surah_num: 2, ayah_from: 1, ayah_to: 7, quality: 'mumtaz', tajweed_notes: null } as const
  it('sends only the five content columns, keyed by id', async () => {
    const calls = stubUpdate({ data: { id: 'q1' }, error: null })
    await updateQuranProgress('q1', { ...patch, student_id: 'x', recorded_at: 'x' } as never)
    expect(calls.table).toBe('quran_progress')
    expect(Object.keys(calls.patch!).sort()).toEqual([
      'ayah_from',
      'ayah_to',
      'quality',
      'surah_num',
      'tajweed_notes',
    ])
  })
  it('reports a zero-row result as a refused edit', async () => {
    stubUpdate({ data: null, error: null })
    await expect(updateQuranProgress('q1', patch)).rejects.toBeInstanceOf(ProgressEditRefusedError)
  })
})
