import { supabase } from './supabase'

/**
 * Editing a recorded Yanbu'a / Quran entry (TAD ADR-045).
 *
 * Who may edit, which columns and the edit marker are enforced by the
 * database (migration 025). This module is what the screens decide around
 * that: who is *offered* the control, how a refused edit is reported, and
 * how the recorder's and editor's names are resolved for display.
 */

/** The fields of either progress row that these helpers read. */
export type EditableEntry = {
  id: string
  tutor_id: string
  client_ref: string | null
  edited_at: string | null
  edited_by: string | null
}

/** Thrown when an UPDATE matched no row — RLS said no, or the row is gone. */
export class ProgressEditRefusedError extends Error {
  constructor() {
    super('The entry could not be edited')
    this.name = 'ProgressEditRefusedError'
  }
}

/**
 * An offline-queued entry is shown with a local stand-in whose `id` is its
 * `client_ref` (the queue's idempotency key). A saved row gets its own id
 * from the database, so the two differ. A stand-in has no row to update yet.
 */
export function isQueuedStandIn(entry: EditableEntry): boolean {
  return entry.client_ref !== null && entry.id === entry.client_ref
}

/**
 * Offer the edit control: to the tutor who recorded the entry, and to an
 * admin. Other tutors of the class, parents and students are not offered
 * it — and the database would refuse them anyway.
 */
export function canEditProgressEntry(
  entry: EditableEntry,
  viewerId: string | null,
  isAdmin: boolean,
): boolean {
  if (!viewerId || isQueuedStandIn(entry)) return false
  return isAdmin || entry.tutor_id === viewerId
}

export type AuthorMap = Map<string, string>

export function authorMap(rows: { user_id: string; full_name: string }[]): AuthorMap {
  return new Map(rows.map((r) => [r.user_id, r.full_name]))
}

/** A name, or null when it cannot be resolved — never a uuid or a blank. */
export function authorLabel(userId: string | null, authors: AuthorMap): string | null {
  return userId ? (authors.get(userId) ?? null) : null
}

/** The latest edit, or null for an entry that was never edited. */
export function editedMarker(entry: EditableEntry): { editorId: string | null; at: string } | null {
  return entry.edited_at ? { editorId: entry.edited_by, at: entry.edited_at } : null
}

/**
 * Names of everyone who recorded or edited this student's entries, via the
 * names-only `fn_progress_authors` (`public.users` is not readable for
 * other people). Zero rows if the caller may not see the student.
 */
export async function fetchProgressAuthors(studentId: string): Promise<AuthorMap> {
  const { data, error } = await supabase.rpc('fn_progress_authors', { p_student: studentId })
  if (error) throw error
  return authorMap(data ?? [])
}
