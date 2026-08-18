import { supabase } from './supabase'
import { offlineQueue, type QueueEntry } from './offlineQueue'
import { submitAttendance } from '../features/attendance/api'
import { confirmPractice } from '../features/murajaah/api'
import { insertYanbuaProgress } from '../features/yanbua/api'
import { insertQuranProgress } from '../features/quran/api'
import type { TablesInsert } from './database.types'

const POSTGRES_UNIQUE_VIOLATION = '23505'

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  )
}

async function replayEntry(entry: QueueEntry): Promise<void> {
  if (entry.kind === 'attendance') {
    await submitAttendance(entry.payload as TablesInsert<'attendance'>[])
    return
  }

  // murajaah_log has no upsert path (`confirmPractice` is a plain
  // insert — see api.ts), so a replay of an entry that already reached
  // the server on an earlier attempt (the response was lost, not the
  // write) hits the table's `unique (assignment_id, date)` constraint.
  // That is success, not a new failure: the same reasoning
  // `getOrCreateTodaySession` already applies to its own race
  // (attendance/api.ts).
  if (entry.kind === 'murajaah') {
    try {
      await confirmPractice(entry.payload as TablesInsert<'murajaah_log'>)
    } catch (err) {
      if (isUniqueViolation(err)) return
      throw err
    }
    return
  }

  // yanbua_progress/quran_progress have no natural unique key at all
  // (unlike attendance's (session_id, student_id) or murajaah_log's
  // (assignment_id, date)), so the payload carries a client-generated
  // `client_ref` (the queue entry's own id) that migration 015 gave
  // both tables a unique constraint on. Same reasoning as murajaah: a
  // 23505 here means this entry's insert already landed on an earlier
  // attempt and only the response was lost, not a new failure.
  if (entry.kind === 'yanbua') {
    try {
      await insertYanbuaProgress(entry.payload as TablesInsert<'yanbua_progress'>)
    } catch (err) {
      if (isUniqueViolation(err)) return
      throw err
    }
    return
  }

  try {
    await insertQuranProgress(entry.payload as TablesInsert<'quran_progress'>)
  } catch (err) {
    if (isUniqueViolation(err)) return
    throw err
  }
}

/**
 * Replays every queued offline write, oldest first. Called on the
 * `online` transition and once on app load (`useOnlineStatus`).
 *
 * Refreshes the Supabase session before replaying anything: a queue
 * left overnight can easily outlive the access token, and replaying
 * with a stale one would fail every entry with a 401 that looks
 * identical to a real rejection. `getSession()` refreshes when the
 * stored token is stale but the refresh token is still valid; if there
 * is no session at all (signed out while offline), replay is skipped
 * entirely rather than attempting writes that can only fail.
 *
 * One failing entry does not block the rest — each is tried
 * independently, and a non-network failure (something genuinely wrong
 * with that entry) is recorded on it via `markAttempt` rather than
 * thrown, so a bad entry does not spin retrying it every time this
 * function runs.
 */
export async function replayQueue(): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return

  const entries = await offlineQueue.list()
  for (const entry of entries) {
    try {
      await replayEntry(entry)
      await offlineQueue.remove(entry.id)
    } catch (err) {
      await offlineQueue.markAttempt(entry, err)
    }
  }
}
