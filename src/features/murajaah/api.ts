import { supabase } from '../../lib/supabase'
import type { Tables, TablesInsert } from '../../lib/database.types'

export type MurajaahAssignment = Tables<'murajaah_assignments'>
export type MurajaahLog = Tables<'murajaah_log'>

/** YYYY-MM-DD in the browser's local timezone (CET/CEST for NL users). */
export function localDate(d: Date = new Date()): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function todayLocalDate(): string {
  return localDate()
}

export async function fetchAssignmentsForStudent(studentId: string): Promise<MurajaahAssignment[]> {
  const { data, error } = await supabase
    .from('murajaah_assignments')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * Active targets across a whole class roster in one query (FR-004's
 * class-wide overview) — `murajaah_assignments` has no `class_id` column,
 * only `student_id`, so the roster's student ids are looked up first and
 * passed in here rather than joining server-side.
 */
export async function fetchActiveAssignmentsForStudents(
  studentIds: string[],
): Promise<MurajaahAssignment[]> {
  if (studentIds.length === 0) return []
  const { data, error } = await supabase
    .from('murajaah_assignments')
    .select('*')
    .in('student_id', studentIds)
    .eq('active', true)
  if (error) throw error
  return data ?? []
}

export async function createAssignment(
  row: TablesInsert<'murajaah_assignments'>,
): Promise<MurajaahAssignment> {
  const { data, error } = await supabase.from('murajaah_assignments').insert(row).select().single()
  if (error) throw error
  return data
}

/**
 * Tutor's only lever for FR-005/FR-007 ("mark surah as Memorized"): flips
 * `active` to false on the tutor's own `murajaah_assignments_rw` policy,
 * which already grants full RW on this table for the tutor's own class
 * students — no new RLS policy needed. There is deliberately no write
 * path from the tutor into `murajaah_log` (`mlog_tutor_read` is
 * read-only; only `mlog_parent_insert` exists, scoped to
 * `confirmed_by = auth.uid()` for the parent's own children) and
 * `murajaah_assignments` has no quality/assessment column, so a live TPA
 * assessment result (Hafal Lancar / Kurang Lancar / Belum Hafal) isn't
 * persisted anywhere — the tutor's in-person judgement call is applied
 * directly as an action (mark memorized, then assign the next portion via
 * `createAssignment`) rather than as a stored record. See
 * TutorAssignView.tsx for where this is surfaced in the UI.
 */
export async function setAssignmentActive(id: string, active: boolean): Promise<MurajaahAssignment> {
  const { data, error } = await supabase
    .from('murajaah_assignments')
    .update({ active })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function fetchLogForAssignment(assignmentId: string): Promise<MurajaahLog[]> {
  const { data, error } = await supabase
    .from('murajaah_log')
    .select('*')
    .eq('assignment_id', assignmentId)
    .order('date', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** This week's confirmations across a set of assignments, for FR-004's overview. */
export async function fetchLogsForAssignments(
  assignmentIds: string[],
  sinceDate: string,
): Promise<MurajaahLog[]> {
  if (assignmentIds.length === 0) return []
  const { data, error } = await supabase
    .from('murajaah_log')
    .select('*')
    .in('assignment_id', assignmentIds)
    .gte('date', sinceDate)
  if (error) throw error
  return data ?? []
}

/** Full confirmation history across a set of assignments (portfolio/history views). */
export async function fetchAllLogsForAssignments(assignmentIds: string[]): Promise<MurajaahLog[]> {
  if (assignmentIds.length === 0) return []
  const { data, error } = await supabase
    .from('murajaah_log')
    .select('*')
    .in('assignment_id', assignmentIds)
    .order('date', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** Parent-only insert (RLS `mlog_parent_insert`) — confirms today's home practice. */
export async function confirmPractice(row: TablesInsert<'murajaah_log'>): Promise<MurajaahLog> {
  const { data, error } = await supabase.from('murajaah_log').insert(row).select().single()
  if (error) throw error
  return data
}
