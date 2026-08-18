import { supabase } from '../../lib/supabase'
import type { Tables } from '../../lib/database.types'

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
export async function publishReport(reportId: string): Promise<PublishResult> {
  return callFunction<PublishResult>('/.netlify/functions/publish-report', {
    method: 'POST',
    body: JSON.stringify({ report_id: reportId }),
  })
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
