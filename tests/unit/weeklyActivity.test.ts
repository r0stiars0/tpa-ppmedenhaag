import { describe, expect, it } from 'vitest'
import { EMPTY_WEEK, fetchWeeklyActivity, type WeekWindow } from '../../src/lib/weeklySummary'

/**
 * The query behind both the dashboard card and the Friday digest.
 *
 * `weeklySummary.test.ts` covers the pure half — `hasActivity`,
 * `attendancePercent` — which is the half that decides *whether* to send
 * a notification. This is the half that decides what the numbers in it
 * are, and it was untested: five queries, a timezone narrowing, and a
 * join through `murajaah_assignments` that is the only place a log row
 * is attributed to a child.
 *
 * The failure it exists to prevent is specific and has happened before
 * in this project: an entry recorded at 00:30 on Monday in Amsterdam is
 * 23:30 Sunday in UTC, so a range filter on a `timestamptz` column
 * silently drops or adds a day's work depending on the season.
 */
const ALI = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ZAINAB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** Monday 10 August 2026 to Friday 14 August, CEST (UTC+2). */
const WINDOW: WeekWindow = {
  from: '2026-08-10',
  to: '2026-08-14',
  toLocalDate: (iso) =>
    new Date(new Date(iso).getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10),
}

interface Tables {
  sessions?: { id: string }[]
  attendance?: { student_id: string; status: string }[]
  yanbua_progress?: { student_id: string; recorded_at: string }[]
  quran_progress?: { student_id: string; recorded_at: string }[]
  murajaah_assignments?: { id: string; student_id: string }[]
  murajaah_log?: { assignment_id: string }[]
}

interface Filter {
  table: string
  select: string
  in: Record<string, unknown>
  gte: Record<string, unknown>
  lte: Record<string, unknown>
  lt: Record<string, unknown>
}

function fakeClient(tables: Tables) {
  const filters: Filter[] = []
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const filter: Filter = { table, select: columns, in: {}, gte: {}, lte: {}, lt: {} }
          filters.push(filter)
          const rows = (tables as Record<string, unknown[]>)[table] ?? []
          const builder = {
            in(column: string, values: unknown) {
              filter.in[column] = values
              return builder
            },
            gte(column: string, value: unknown) {
              filter.gte[column] = value
              return builder
            },
            lte(column: string, value: unknown) {
              filter.lte[column] = value
              return builder
            },
            lt(column: string, value: unknown) {
              filter.lt[column] = value
              return builder
            },
            then: (resolve: (result: { data: unknown[] }) => void) => resolve({ data: rows }),
          }
          return builder
        },
      }
    },
  } as unknown as Parameters<typeof fetchWeeklyActivity>[0]
  return { client, filters }
}

describe('fetchWeeklyActivity', () => {
  it('asks nothing at all for an empty student list', async () => {
    // The digest runs hourly and fans out over whatever it finds. A
    // parent with no enrolled children must not cost five queries.
    const { client, filters } = fakeClient({})
    await expect(fetchWeeklyActivity(client, [], WINDOW)).resolves.toEqual(new Map())
    expect(filters).toHaveLength(0)
  })

  it('returns a zeroed week for a child with nothing recorded, rather than no entry', async () => {
    // "No activity" and "not in the result" are different things to the
    // caller: `hasActivity` has to be able to answer false, and the
    // dashboard card has to render a quiet week rather than a spinner.
    const { client } = fakeClient({})
    const result = await fetchWeeklyActivity(client, [ALI], WINDOW)
    expect(result.get(ALI)).toEqual(EMPTY_WEEK)
  })

  it('counts attendance per child and per status', async () => {
    const { client } = fakeClient({
      sessions: [{ id: 'session-1' }, { id: 'session-2' }],
      attendance: [
        { student_id: ALI, status: 'present' },
        { student_id: ALI, status: 'absent' },
        { student_id: ZAINAB, status: 'late' },
      ],
    })
    const result = await fetchWeeklyActivity(client, [ALI, ZAINAB], WINDOW)
    expect(result.get(ALI)).toMatchObject({ recorded: 2, present: 1, absent: 1, late: 0 })
    expect(result.get(ZAINAB)).toMatchObject({ recorded: 1, present: 0, absent: 0, late: 1 })
  })

  it('bounds the attendance read by the week’s sessions, not by a child’s history', async () => {
    // Two queries rather than one join, so the second is bounded by the
    // handful of sessions in a week instead of every attendance row a
    // child has ever had.
    const { client, filters } = fakeClient({
      sessions: [{ id: 'session-1' }],
      attendance: [{ student_id: ALI, status: 'present' }],
    })
    await fetchWeeklyActivity(client, [ALI], WINDOW)

    const sessions = filters.find((f) => f.table === 'sessions')
    expect(sessions?.gte.date).toBe('2026-08-10')
    expect(sessions?.lte.date).toBe('2026-08-14')

    const attendance = filters.find((f) => f.table === 'attendance')
    expect(attendance?.in.session_id).toEqual(['session-1'])
    expect(attendance?.in.student_id).toEqual([ALI])
  })

  it('skips the attendance query entirely in a week with no sessions', async () => {
    // A school holiday. `in ('session_id', [])` would be a round trip
    // that can only return nothing.
    const { client, filters } = fakeClient({ sessions: [] })
    const result = await fetchWeeklyActivity(client, [ALI], WINDOW)
    expect(filters.some((f) => f.table === 'attendance')).toBe(false)
    expect(result.get(ALI)?.recorded).toBe(0)
  })

  it('fetches a day wide on each side and narrows in the family’s timezone', async () => {
    // The CET/CEST bug this module keeps running into. The range asked of
    // Postgres is deliberately loose — a whole day either side — and the
    // decision is made in the caller's own timezone afterwards, rather
    // than by guessing an offset in the filter.
    const { client, filters } = fakeClient({
      yanbua_progress: [
        // 00:30 Monday in Amsterdam: last Sunday, in UTC. Inside the week.
        { student_id: ALI, recorded_at: '2026-08-09T22:30:00Z' },
        // 22:00 Friday UTC is midnight Saturday in Amsterdam. Outside.
        { student_id: ALI, recorded_at: '2026-08-14T22:00:00Z' },
        // Comfortably inside.
        { student_id: ALI, recorded_at: '2026-08-12T09:00:00Z' },
      ],
    })
    const result = await fetchWeeklyActivity(client, [ALI], WINDOW)

    const yanbua = filters.find((f) => f.table === 'yanbua_progress')
    expect(yanbua?.gte.recorded_at).toBe('2026-08-09T00:00:00Z')
    expect(yanbua?.lt.recorded_at).toBe('2026-08-16T00:00:00Z')
    expect(result.get(ALI)?.yanbua).toBe(2)
  })

  it('narrows Quran entries the same way, and keeps the two counts apart', async () => {
    const { client } = fakeClient({
      yanbua_progress: [{ student_id: ALI, recorded_at: '2026-08-12T09:00:00Z' }],
      quran_progress: [
        { student_id: ALI, recorded_at: '2026-08-12T09:00:00Z' },
        { student_id: ALI, recorded_at: '2026-08-14T22:00:00Z' },
      ],
    })
    const result = await fetchWeeklyActivity(client, [ALI], WINDOW)
    expect(result.get(ALI)).toMatchObject({ yanbua: 1, quran: 1 })
  })

  it('attributes home-practice logs through the assignment, to the right child', async () => {
    // `murajaah_log` is keyed on the assignment, not the student, so this
    // is the one count that can silently land on a sibling. Both children
    // are in the same result and both have a target.
    const { client, filters } = fakeClient({
      murajaah_assignments: [
        { id: 'assign-ali', student_id: ALI },
        { id: 'assign-zainab', student_id: ZAINAB },
      ],
      murajaah_log: [
        { assignment_id: 'assign-ali' },
        { assignment_id: 'assign-ali' },
        { assignment_id: 'assign-zainab' },
      ],
    })
    const result = await fetchWeeklyActivity(client, [ALI, ZAINAB], WINDOW)
    expect(result.get(ALI)?.murajaah).toBe(2)
    expect(result.get(ZAINAB)?.murajaah).toBe(1)

    // `murajaah_log.date` is a plain date, so it needs no widening — the
    // filter is the week itself.
    const logs = filters.find((f) => f.table === 'murajaah_log')
    expect(logs?.gte.date).toBe('2026-08-10')
    expect(logs?.lte.date).toBe('2026-08-14')
  })

  it('skips the log query when no child has a target', async () => {
    const { client, filters } = fakeClient({ murajaah_assignments: [] })
    await fetchWeeklyActivity(client, [ALI], WINDOW)
    expect(filters.some((f) => f.table === 'murajaah_log')).toBe(false)
  })

  it('ignores rows for a child that was not asked about', async () => {
    // The service-role client bypasses RLS, so the digest's own filtering
    // is the only thing keeping one family's numbers out of another's
    // summary. A row that comes back for an unrequested student is
    // dropped rather than added to the map.
    const { client } = fakeClient({
      sessions: [{ id: 'session-1' }],
      attendance: [
        { student_id: ALI, status: 'present' },
        { student_id: ZAINAB, status: 'present' },
      ],
      yanbua_progress: [{ student_id: ZAINAB, recorded_at: '2026-08-12T09:00:00Z' }],
    })
    const result = await fetchWeeklyActivity(client, [ALI], WINDOW)
    expect([...result.keys()]).toEqual([ALI])
    expect(result.get(ALI)).toMatchObject({ recorded: 1, yanbua: 0 })
  })
})
