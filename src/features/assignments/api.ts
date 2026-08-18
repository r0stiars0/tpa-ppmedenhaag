import { supabase } from '../../lib/supabase'
import type { Tables, TablesInsert } from '../../lib/database.types'

export type Assignment = Tables<'assignments'>
export type AssignmentStatusRow = Tables<'assignment_status'>

/** YYYY-MM-DD in the browser's local timezone (CET/CEST for NL users). */
export function todayLocalDate(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export async function fetchClassAssignments(classId: string): Promise<Assignment[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('*')
    .eq('class_id', classId)
    .order('due_date', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createAssignment(row: TablesInsert<'assignments'>): Promise<Assignment> {
  const { data, error } = await supabase.from('assignments').insert(row).select().single()
  if (error) throw error
  return data
}

/** One row per assigned student, defaulting to `status: 'pending'` (column default). */
export async function createAssignmentStatuses(
  rows: TablesInsert<'assignment_status'>[],
): Promise<AssignmentStatusRow[]> {
  const { data, error } = await supabase.from('assignment_status').insert(rows).select()
  if (error) throw error
  return data ?? []
}

export async function fetchAssignmentStatuses(assignmentId: string): Promise<AssignmentStatusRow[]> {
  const { data, error } = await supabase
    .from('assignment_status')
    .select('*')
    .eq('assignment_id', assignmentId)
  if (error) throw error
  return data ?? []
}

export async function updateAssignmentStatus(
  id: string,
  patch: Pick<Tables<'assignment_status'>, 'status' | 'notes'>,
): Promise<AssignmentStatusRow> {
  const { data, error } = await supabase
    .from('assignment_status')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * The family-side read path: `assignment_status` rows are the only ones
 * scoped to a single student under RLS (`astatus_parent_read` /
 * `astatus_student_read`); `assignments` is scoped per-class instead,
 * so it can't be filtered by student_id directly. Fetched separately
 * and stitched client-side — same pattern as
 * `attendance/api.ts#fetchAttendanceHistory` joining sessions.
 */
export async function fetchMyAssignmentStatuses(studentId: string): Promise<AssignmentStatusRow[]> {
  const { data, error } = await supabase
    .from('assignment_status')
    .select('*')
    .eq('student_id', studentId)
  if (error) throw error
  return data ?? []
}

export async function fetchAssignmentsByIds(ids: string[]): Promise<Assignment[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase.from('assignments').select('*').in('id', ids)
  if (error) throw error
  return data ?? []
}
