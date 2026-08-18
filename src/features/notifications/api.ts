import { supabase } from '../../lib/supabase'
import type { Tables } from '../../lib/database.types'

/**
 * The notification centre's data access.
 *
 * Every query here is scoped by RLS to `user_id = auth.uid()`
 * (migration 012), so none of them filters by user: a caller cannot ask
 * for someone else's notifications, and a bug here cannot widen that.
 * The client also has no INSERT or DELETE grant on the table at all —
 * rows are written only by the notification Functions under the
 * service-role key, and removed only by `prune-notifications` — so the
 * one write below is the one write that exists.
 */
export type NotificationRow = Tables<'notifications'> & {
  students: { full_name: string } | null
}

/**
 * The child's name is joined rather than stored on the row (TAD
 * ADR-017), so it is read here. RLS applies to the embedded table too,
 * which means this join cannot become a way to read a student a caller
 * is not entitled to — the worst case is a null.
 */
const SELECT = '*, students(full_name)'

export async function fetchNotifications(limit = 50): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select(SELECT)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as NotificationRow[]
}

/**
 * Just the count, for the TopNav badge — `head: true` so the rows
 * themselves never cross the wire. The bell renders on every screen, so
 * this is the one query in the app that runs regardless of where the
 * user is.
 */
export async function fetchUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) throw error
  return count ?? 0
}

/**
 * Marks everything currently unread as read.
 *
 * `read_at` is the only column the `authenticated` role holds an UPDATE
 * grant on (migration 012), so this is not merely the only update the
 * app performs — it is the only one the database would accept. A client
 * cannot rewrite `event` or `context` and make the screen render
 * something that never happened.
 */
export async function markAllRead(): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
  if (error) throw error
}
