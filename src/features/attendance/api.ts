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

/** Today's session for a class if one exists, else null. Never creates. */
export async function fetchSessionForDate(classId: string, date: string): Promise<Session | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('class_id', classId)
    .eq('date', date)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

/**
 * Implements the PRD 1.6 user flow ("current session auto-detected by
 * date/time"), now driven by the group's schedule rather than raw
 * "today" (TAD ADR-037): look up the session for `date` on this class,
 * creating it if absent. `date` must be one of the class's
 * `meeting_days` — `trg_sessions_meeting_day` refuses the INSERT
 * otherwise; the attendance screen only ever passes a scheduled date, so
 * that error means a bug, not a user mistake. A unique (class_id, date)
 * constraint means a concurrent create from a co-tutor is possible — on
 * conflict we just re-select rather than erroring out the tutor's screen.
 */
export async function getOrCreateScheduledSession(
  classId: string,
  date: string,
  tutorId: string,
): Promise<Session> {
  const existing = await fetchSessionForDate(classId, date)
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

/**
 * The meeting days (and time-range text) of the class a student is
 * enrolled in, for the read-only "Lesdagen" line on the family
 * attendance screen (TAD ADR-037). `classes_read` already grants a
 * parent / 16+ student the class row for their own child, so no policy
 * change is needed; the embed resolves through students.class_id. Null
 * when the student is not enrolled in any class.
 */
export async function fetchStudentMeetingDays(
  studentId: string,
): Promise<{ meeting_days: number[]; schedule: string | null } | null> {
  const { data, error } = await supabase
    .from('students')
    .select('class:classes(meeting_days, schedule)')
    .eq('id', studentId)
    .maybeSingle()
  if (error) throw error
  const cls = (data as { class: { meeting_days: number[]; schedule: string | null } | null } | null)
    ?.class
  return cls ?? null
}

export async function fetchAttendanceForSession(sessionId: string): Promise<Tables<'attendance'>[]> {
  const { data, error } = await supabase.from('attendance').select('*').eq('session_id', sessionId)
  if (error) throw error
  return data ?? []
}

export async function submitAttendance(rows: TablesInsert<'attendance'>[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'session_id,student_id' })
  if (error) throw error
}

// ─── Tutor attendance (TAD ADR-041) ──────────────────────────────────
// The register records the tutors' own attendance in `tutor_attendance`,
// a sibling of `attendance` keyed on the same session. Read by an admin
// (any class) or a tutor of the session's class; a guardian or 16+
// student sees nothing (the table has no policy for them).

export interface ClassTutor {
  user_id: string
  full_name: string
}

/**
 * The tutors named in a class's `tutor_ids`, id + name, to label the
 * register's "Ustadz" section. Goes through `fn_class_tutors` rather
 * than a `users` select because `users_self_read` does not expose other
 * users to a tutor; the function returns zero rows to a caller who is
 * neither an admin nor a tutor of the class (the `fn_student_guardians`
 * pattern).
 */
export async function fetchClassTutors(classId: string): Promise<ClassTutor[]> {
  const { data, error } = await supabase.rpc('fn_class_tutors', { p_class: classId })
  if (error) throw error
  return data ?? []
}

export async function fetchTutorAttendanceForSession(
  sessionId: string,
): Promise<Tables<'tutor_attendance'>[]> {
  const { data, error } = await supabase
    .from('tutor_attendance')
    .select('*')
    .eq('session_id', sessionId)
  if (error) throw error
  return data ?? []
}

export async function submitTutorAttendance(
  rows: TablesInsert<'tutor_attendance'>[],
): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase
    .from('tutor_attendance')
    .upsert(rows, { onConflict: 'session_id,tutor_id' })
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
