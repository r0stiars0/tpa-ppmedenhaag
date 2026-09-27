import { supabase } from '../../lib/supabase'
import type { Database, Tables, TablesInsert } from '../../lib/database.types'
import { fetchClassRoster } from '../../lib/roster'
import type { OverviewRow, OverviewSession } from '../../lib/attendanceStats'

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

export interface StudentGroupOption {
  id: string
  name: string
  meeting_days: number[]
  schedule: string | null
  tracks_progress: boolean
}

/**
 * The ACTIVE groups a student is in, with their meeting days (and
 * time-range text), for the family attendance screen's read-only
 * "Lesdagen" lines (TAD ADR-037) — one per group since PRD Feature 8.
 * `class_members_family_read` and `classes_read` grant a family exactly
 * these rows for their own child; an archived group is history, not a
 * group the child meets in.
 */
export async function fetchStudentGroups(studentId: string): Promise<StudentGroupOption[]> {
  const { data, error } = await supabase
    .from('class_members')
    .select('class:classes!inner(id, name, meeting_days, schedule, tracks_progress, archived_at)')
    .eq('student_id', studentId)
    .is('class.archived_at', null)
  if (error) throw error
  return ((data ?? []) as { class: StudentGroupOption | null }[])
    .map((row) => row.class)
    .filter((cls): cls is StudentGroupOption => cls !== null)
    .map(({ id, name, meeting_days, schedule, tracks_progress }) => ({ id, name, meeting_days, schedule, tracks_progress }))
    .sort((a, b) => a.name.localeCompare(b.name))
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
 * register's tutor section. Goes through `fn_class_tutors` rather
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

// ─── Attendance graphs (TAD ADR-046) ──────────────────────────────────
// Both reads below use grants the caller already holds, so there is no
// new policy or migration.

/**
 * One group's recent sessions, newest first, each with the student
 * statuses recorded against it — the "Kehadiran santri" tile
 * (ADR-046(a)). A tutor reads these through the ordinary tutor grants on
 * `sessions` and `attendance`, an admin through the admin ones. 40 rows
 * covers the 8 recorded sessions the tile draws with room for opened but
 * unrecorded ones in between.
 */
export async function fetchGroupSessionStats(
  classId: string,
): Promise<{ date: string; statuses: AttendanceStatus[] }[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('date, attendance(status)')
    .eq('class_id', classId)
    .order('date', { ascending: false })
    .limit(40)
  if (error) throw error
  return ((data ?? []) as { date: string; attendance: { status: AttendanceStatus }[] | null }[]).map(
    (row) => ({ date: row.date, statuses: (row.attendance ?? []).map((a) => a.status) }),
  )
}

export interface TutorOverviewData {
  classes: { id: string; name: string; archived: boolean }[]
  sessions: OverviewSession[]
  rows: OverviewRow[]
  /** `fn_class_tutors` per active group — today's assignment. */
  tutorsByClass: Record<string, ClassTutor[]>
  /** The name of everyone with a recorded row in range. */
  names: Record<string, string>
}

/**
 * Everything Hadir › Guru needs for one date range, admin only
 * (ADR-046(d)/(e)): every group, every session in range with whether
 * anything was recorded on it, every tutor row in range, and each active
 * group's tutor list. It relies on `tutor_attendance_admin_all` (RLS-85)
 * and the admin grants on `classes`, `sessions` and `attendance`; a
 * non-admin would simply get their own groups' rows back, and the screen
 * is never shown to one.
 */
export async function fetchTutorOverviewData(from: string, to: string): Promise<TutorOverviewData> {
  const [classesRes, sessionsRes, rowsRes] = await Promise.all([
    supabase.from('classes').select('id, name, archived_at').order('name'),
    supabase
      .from('sessions')
      .select('id, class_id, date, attendance(count), tutor_attendance(count)')
      .gte('date', from)
      .lte('date', to),
    supabase
      .from('tutor_attendance')
      .select('session_id, tutor_id, status, reason, session:sessions!inner(date), tutor:users!tutor_attendance_tutor_id_fkey(full_name)')
      .gte('session.date', from)
      .lte('session.date', to),
  ])
  if (classesRes.error) throw classesRes.error
  if (sessionsRes.error) throw sessionsRes.error
  if (rowsRes.error) throw rowsRes.error

  const classes = (classesRes.data ?? []).map((c) => ({ id: c.id, name: c.name, archived: c.archived_at !== null }))
  const active = classes.filter((c) => !c.archived)
  const lists = await Promise.all(active.map((c) => fetchClassTutors(c.id)))
  const tutorsByClass = Object.fromEntries(active.map((c, i) => [c.id, lists[i]]))

  type CountEmbed = { count: number }[] | null
  const sessions = (
    (sessionsRes.data ?? []) as unknown as {
      id: string
      class_id: string
      date: string
      attendance: CountEmbed
      tutor_attendance: CountEmbed
    }[]
  ).map((s) => ({
    id: s.id,
    classId: s.class_id,
    date: s.date,
    held: (s.attendance?.[0]?.count ?? 0) + (s.tutor_attendance?.[0]?.count ?? 0) > 0,
  }))

  const names: Record<string, string> = {}
  const rows = (
    (rowsRes.data ?? []) as unknown as {
      session_id: string
      tutor_id: string
      status: AttendanceStatus
      reason: string | null
      tutor: { full_name: string } | null
    }[]
  ).map((r) => {
    names[r.tutor_id] = r.tutor?.full_name ?? ''
    return { sessionId: r.session_id, tutorId: r.tutor_id, status: r.status, reason: r.reason }
  })

  return { classes, sessions, rows, tutorsByClass, names }
}

export interface AttendanceHistoryRow {
  /** The session's id — one row per session attended. */
  id: string
  status: AttendanceStatus
  /**
   * Null for anyone but the session's own group tutors, admins and the
   * child's family — the reason can carry health information and never
   * crosses groups (PRD Feature 8 FR-006, DPIA R4).
   */
  reason: string | null
  date: string
  classId: string
  className: string
}

/**
 * A student's attendance across ALL their groups, newest first, each
 * row labelled with its group (PRD Feature 8 FR-003). Read through
 * `fn_student_attendance_history` rather than the `attendance` table:
 * a tutor's grant on that table is scoped to their own groups' sessions,
 * and the function is the one path by which a child's own attendance
 * crosses groups — with the absence reason withheld where it must be
 * (TAD ADR-045(d)). Families read the same function and get the reason.
 */
export async function fetchAttendanceHistory(studentId: string): Promise<AttendanceHistoryRow[]> {
  const { data, error } = await supabase.rpc('fn_student_attendance_history', { p_student: studentId })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.session_id,
    status: row.status,
    reason: row.reason,
    date: row.session_date,
    classId: row.class_id,
    className: row.class_name,
  }))
}
