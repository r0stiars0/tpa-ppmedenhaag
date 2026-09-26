import { amsterdamDate, type NotificationEvent } from './notifications'
import type { NotificationContext } from './notifyStudent'

/**
 * What `notify-group-content` sends for a new announcement or material
 * (PRD Feature 8 FR-004/FR-005, TAD ADR-045(g)). Split out of the
 * Function so the rules are unit-testable without a database.
 *
 *   - An announcement is one notification per announcement (`ref_id` =
 *     its id). Its title goes into the in-app row, which only a
 *     signed-in recipient reads; the push names only the child and the
 *     group (DPIA R6).
 *   - Materials are one notification per group per day (`ref_id` = the
 *     group), so five slides uploaded in one sitting are one message.
 *     No title, file name or link goes anywhere in the notification.
 */
export interface GroupContentRow {
  table: 'group_announcements' | 'group_materials'
  id: string
  classId: string
  groupName: string
  title: string
  createdAt: string
}

export interface GroupContentNotice {
  event: Extract<NotificationEvent, 'groupAnnouncement' | 'newMaterial'>
  refId: string
  date: string
  context: NotificationContext
  group: string
}

export function groupContentNotice(row: GroupContentRow): GroupContentNotice {
  const date = amsterdamDate(new Date(row.createdAt))
  if (row.table === 'group_announcements') {
    return {
      event: 'groupAnnouncement',
      refId: row.id,
      date,
      context: { title: row.title, group: row.groupName },
      group: row.groupName,
    }
  }
  return { event: 'newMaterial', refId: row.classId, date, context: { group: row.groupName }, group: row.groupName }
}

/** How long an unreferenced object may sit before the clean-up takes it: an upload in progress writes its row seconds after its object. */
export const ORPHAN_GRACE_HOURS = 24

/**
 * The `group-materials` objects no material points at (ADR-045(f)). An
 * upload is object first, then row, so a crash between the two leaves an
 * object nobody can see. Only objects older than the grace period are
 * picked, so an upload in progress is never taken.
 */
export function orphanedMaterialObjects(
  objects: readonly { name: string; created_at: string }[],
  referencedPaths: ReadonlySet<string>,
  now: Date,
): string[] {
  const cutoff = now.getTime() - ORPHAN_GRACE_HOURS * 3600 * 1000
  return objects
    .filter((o) => !referencedPaths.has(o.name) && new Date(o.created_at).getTime() < cutoff)
    .map((o) => o.name)
}
