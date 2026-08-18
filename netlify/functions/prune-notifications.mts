import type { Config } from '@netlify/functions'
import { HOURLY, scheduledHandler } from './lib/scheduled'
import { addDays } from '../../src/lib/murajaah'

/**
 * Retention for the notification centre — DPIA risk **R5**, "data kept
 * longer than needed".
 *
 * The centre is the first table in this project that grows without
 * bound on its own. Every other student-scoped table grows because
 * someone recorded something: a session, a page, a confirmation. This
 * one grows because *time passed* — three scheduled Functions between
 * them can write a row per child per day whether or not anybody did
 * anything. Left alone it is, within a couple of years, the largest
 * store of "who was told what about which child" in the system, and
 * none of it has any use after the first week.
 *
 * ── Ninety days, and why not less ───────────────────────────────────
 * The window has to outlast the reason a family opens the list. The
 * longest-lived of those is the year-end report notification, which a
 * parent may not act on for weeks; a term is the natural unit either
 * side of it. Ninety days keeps a full term visible and still means a
 * child's record of TPA notifications is measured in months, not in
 * the years their progress data is kept for (that has its own,
 * separate retention question — checklist §6's `[IT TEAM]` N=3).
 *
 * ── Why deletion rather than a shorter query window ─────────────────
 * A screen that only *shows* ninety days leaves the rest in the table,
 * which is not what "kept no longer than needed" means and not what a
 * subject access request would return. The rows go.
 *
 * ── Why its own job ─────────────────────────────────────────────────
 * Folding this into `weekly-progress-digest`, which already runs
 * weekly, was the obvious saving. It is the wrong shape: retention is a
 * legal obligation and the digest is a courtesy, so a Friday the digest
 * skips — no activity, a holiday, a bad deploy — would silently be a
 * Friday nothing was deleted, and nobody would notice for months.
 * Separate job, its own hour, its own line in the log.
 *
 * 03:00 Europe/Amsterdam: after midnight so "90 days ago" has just
 * moved, and in the quietest hour the TPA has.
 */
export const RETENTION_DAYS = 90

export default scheduledHandler({
  hour: 3,
  run: async (client, today) => {
    const cutoff = addDays(today, -RETENTION_DAYS)

    // Counted rather than assumed: `delete` returns no count without
    // it, and a retention job that cannot say what it deleted is not
    // evidence of anything at a DPIA review.
    const { data, error } = await client
      .from('notifications')
      .delete()
      .lt('created_at', `${cutoff}T00:00:00Z`)
      .select('id')
    if (error) throw new Error(error.message)

    return { deleted: data?.length ?? 0, cutoff, retentionDays: RETENTION_DAYS }
  },
})

export const config: Config = { schedule: HOURLY }
