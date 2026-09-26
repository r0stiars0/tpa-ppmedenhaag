import { supabase } from '../../lib/supabase'
import type { Database, Tables } from '../../lib/database.types'

export type YearEndReport = Tables<'year_end_reports'>

/** Tutor-editable fields only — stats, status, pdf_path are server-managed. */
export type ReportEdit = Pick<
  YearEndReport,
  | 'narrative'
  | 'yanbua_grade'
  | 'yanbua_notes'
  | 'quran_grade'
  | 'quran_notes'
  | 'murajaah_grade'
  | 'murajaah_notes'
  | 'overall_grade'
>

/**
 * Reports for a set of students, newest academic year first.
 *
 * There is no status filter here on purpose: RLS decides what comes back
 * (tutor → own class, any status; parent/student → own child/self,
 * `status = 'published'` only, per migration 005). Filtering by status in
 * the client would imply drafts are something the UI is responsible for
 * hiding — they are invisible to families at the database layer, and this
 * app never builds a screen that would only make sense if that failed.
 */
export async function fetchReportsForStudents(studentIds: string[]): Promise<YearEndReport[]> {
  if (studentIds.length === 0) return []
  const { data, error } = await supabase
    .from('year_end_reports')
    .select('*')
    .in('student_id', studentIds)
    .order('academic_year', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * Full names for a set of authoring tutors, keyed by user id.
 *
 * Only ever called from the admin branch of the reports screen, and only
 * admin can get a non-trivial answer: `users_self_read` is
 * `id = auth.uid() or fn_is_admin()`, so a tutor asking for a colleague's
 * name gets an empty result rather than an error. That is why no other
 * feature shows a "recorded by" name to anyone — admin is the first role
 * with a read path into the directory, and it needs one to say *which*
 * tutor has to re-publish a report it just edited (ADR-014).
 */
export async function fetchTutorNames(tutorIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(tutorIds)]
  if (unique.length === 0) return new Map()
  const { data, error } = await supabase.from('users').select('id, full_name').in('id', unique)
  if (error) throw error
  return new Map((data ?? []).map((u) => [u.id, u.full_name]))
}

/** Tutor edit of narrative/grades — allowed on drafts and published reports alike (FR-006). */
export async function updateReport(id: string, patch: Partial<ReportEdit>): Promise<YearEndReport> {
  const { data, error } = await supabase
    .from('year_end_reports')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

async function callFunction<T>(path: string, init: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...(init.headers ?? {}),
    },
  })

  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`)
  return body as T
}

export interface GenerateDraftsResult {
  created_count: number
  skipped_existing: number
  skipped_no_tutor: number
  /** Group sections added to draft reports (FR-008). */
  sections_created?: number
}

/** Admin-only (enforced in the Function, not here) — FR-001 bulk draft generation. */
export async function generateDrafts(params: {
  academic_year: string
  class_id?: string | null
}): Promise<GenerateDraftsResult> {
  return callFunction<GenerateDraftsResult>('/.netlify/functions/generate-year-end-drafts', {
    method: 'POST',
    body: JSON.stringify({
      academic_year: params.academic_year,
      ...(params.class_id ? { class_id: params.class_id } : {}),
    }),
  })
}

export interface PublishResult {
  report_id: string
  pdf_path: string
  published_at: string
}

/**
 * Publishes a draft, or regenerates the PDF of an already-published
 * report after an edit. PDF rendering and the Storage write both need the
 * service-role key, so this can only ever be a Function call — a
 * PostgREST PATCH from the browser can change the narrative but can never
 * produce the PDF that has to go with it.
 */
export async function publishReport(
  reportId: string,
  options: { omitEmptySections?: boolean } = {},
): Promise<PublishResult> {
  return callFunction<PublishResult>('/.netlify/functions/publish-report', {
    method: 'POST',
    body: JSON.stringify({
      report_id: reportId,
      ...(options.omitEmptySections ? { omit_empty_sections: true } : {}),
    }),
  })
}

// ---- group sections (PRD Feature 8 FR-008, TAD ADR-045(h)) ------------

export type ReportSection = Tables<'year_end_report_sections'> & { class: { name: string } | null }

/** A report's sections, for whoever may read the report (RLS). */
export async function fetchReportSections(reportId: string): Promise<ReportSection[]> {
  const { data, error } = await supabase
    .from('year_end_report_sections')
    .select('*, class:classes(name)')
    .eq('report_id', reportId)
  if (error) throw error
  return ((data ?? []) as ReportSection[]).sort((a, b) => (a.class?.name ?? '').localeCompare(b.class?.name ?? ''))
}

/** Grade and narrative only: the only columns a client may write. */
export async function updateSection(
  id: string,
  patch: { grade: Tables<'year_end_report_sections'>['grade']; narrative: string | null },
): Promise<void> {
  const { data, error } = await supabase
    .from('year_end_report_sections')
    .update({ grade: patch.grade, narrative: patch.narrative?.trim() ? patch.narrative : null })
    .eq('id', id)
    .select('id')
  if (error) throw error
  // RLS turns a locked section into "no row matched", not an error.
  if (!data || data.length === 0) throw new Error('locked')
}

export type MyReportSection = Database['public']['Functions']['fn_my_report_sections']['Returns'][number]

/** The sections a group's tutor writes, with what they cannot read from the report itself. */
export async function fetchMyReportSections(classId: string): Promise<MyReportSection[]> {
  const { data, error } = await supabase.rpc('fn_my_report_sections', { p_class: classId })
  if (error) throw error
  return data ?? []
}

/** Admin: the tutors of the student's active groups, the only valid authors. */
export async function fetchAuthorCandidates(studentId: string): Promise<{ id: string; name: string; group: string }[]> {
  const { data, error } = await supabase
    .from('class_members')
    .select('class:classes!inner(name, tutor_ids, archived_at)')
    .eq('student_id', studentId)
    .is('class.archived_at', null)
  if (error) throw error
  const byTutor = new Map<string, string>()
  for (const row of (data ?? []) as { class: { name: string; tutor_ids: string[] } }[]) {
    for (const id of row.class.tutor_ids ?? []) if (!byTutor.has(id)) byTutor.set(id, row.class.name)
  }
  // Not a 16+ student assistant: the author's name goes on the family's
  // PDF (Resolved Decision 33); fn_admin_set_report_author refuses them too.
  const { data: assistants, error: assistantsError } = await supabase
    .from('students')
    .select('user_id')
    .in('user_id', [...byTutor.keys()])
  if (assistantsError) throw assistantsError
  for (const a of assistants ?? []) if (a.user_id) byTutor.delete(a.user_id)
  const names = await fetchTutorNames([...byTutor.keys()])
  return [...byTutor.entries()]
    .map(([id, group]) => ({ id, name: names.get(id) ?? '—', group }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Admin: reassign a draft's author (Resolved Decision 21). Through an RPC
 * because `tutor_id` has no column grant, on purpose — see migration 029.
 */
export async function updateReportAuthor(reportId: string, tutorId: string): Promise<YearEndReport> {
  const { error } = await supabase.rpc('fn_admin_set_report_author', { p_report: reportId, p_tutor: tutorId })
  if (error) throw error
  const { data, error: readError } = await supabase.from('year_end_reports').select('*').eq('id', reportId).single()
  if (readError) throw readError
  return data
}

/**
 * Short-lived signed URL for a report's PDF (FR-005). The `reports`
 * bucket is private with no client read policy at all, so this Function
 * is the only way to reach the object — and it re-checks the caller's
 * authorization itself, because a signed URL bypasses RLS once minted.
 */
export async function fetchReportPdfUrl(reportId: string): Promise<string> {
  const result = await callFunction<{ url: string; expires_in: number }>(
    `/.netlify/functions/report-pdf?report_id=${encodeURIComponent(reportId)}`,
    { method: 'GET' },
  )
  return result.url
}
