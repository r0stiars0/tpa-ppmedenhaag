import { supabase } from '../../lib/supabase'
import type { Database, Tables, TablesInsert } from '../../lib/database.types'
import { fetchClassRoster } from '../../lib/roster'

type AttendanceStatus = Database['public']['Enums']['attendance_status']
type Session = Tables<'sessions'>

export { fetchClassRoster }
export type { RosterStudent } from '../../lib/roster'

/** YYYY-MM-DD in the browser's local timezone (CET/CEST for NL users). */
export function todayLocalDate(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Implements the PRD 1.6 user flow ("current session auto-detected by
 * date/time"): look up today's session for this class, creating it on
 * first open of the day. A unique (class_id, date) constraint means a
 * concurrent create from a co-tutor is possible — on conflict we just
 * re-select rather than erroring out the tutor's screen.
 */
export async function getOrCreateTodaySession(classId: string, tutorId: string): Promise<Session> {
  const date = todayLocalDate()

  const { data: existing, error: selectError } = await supabase
    .from('sessions')
    .select('*')
    .eq('class_id', classId)
    .eq('date', date)
    .maybeSingle()
  if (selectError) throw selectError
  if (existing) return existing

  const { data: created, error: insertError } = await supabase
    .from('sessions')
    .insert({ class_id: classId, date, tutor_id: tutorId })
    .select()
    .single()
  if (!insertError) return created

  if (insertError.code === '23505') {
    const { data: raced, error: racedError } = await supabase
      .from('sessions')
      .select('*')
      .eq('class_id', classId)
      .eq('date', date)
      .single()
    if (racedError) throw racedError
    return raced
  }
  throw insertError
}

export async function fetchAttendanceForSession(sessionId: string): Promise<Tables<'attendance'>[]> {
  const { data, error } = await supabase.from('attendance').select('*').eq('session_id', sessionId)
  if (error) throw error
  return data ?? []
}

export async function submitAttendance(rows: TablesInsert<'attendance'>[]): Promise<void> {
  const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'session_id,student_id' })
  if (error) throw error
}

export interface AttendanceHistoryRow {
  id: string
  status: AttendanceStatus
  reason: string | null
  date: string
}

/**
 * Fetches all attendance rows for a student and stitches in the session
 * date via a second query (rather than a PostgREST embedded-resource
 * filter) — simpler to keep correctly typed, and a student's full
 * attendance history is small enough (~100 rows/year per TAD storage
 * estimate) that client-side date filtering is fine for MVP.
 */
export async function fetchAttendanceHistory(studentId: string): Promise<AttendanceHistoryRow[]> {
  const { data: rows, error } = await supabase
    .from('attendance')
    .select('id, status, reason, session_id')
    .eq('student_id', studentId)
  if (error) throw error
  if (!rows || rows.length === 0) return []

  const sessionIds = [...new Set(rows.map((r) => r.session_id))]
  const { data: sessions, error: sessionsError } = await supabase
    .from('sessions')
    .select('id, date')
    .in('id', sessionIds)
  if (sessionsError) throw sessionsError

  const dateBySession = new Map((sessions ?? []).map((s) => [s.id, s.date]))
  return rows
    .map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      date: dateBySession.get(r.session_id) ?? '',
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}
