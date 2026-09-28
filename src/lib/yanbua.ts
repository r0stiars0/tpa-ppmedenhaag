import type { Database } from './database.types'

type YanbuahMastery = Database['public']['Enums']['yanbuah_mastery']

export interface JilidRef {
  jilid: number
  page_count: number
}

/**
 * Page numbering runs continuously across the whole 7-jilid Yanbu'a book,
 * not per jilid — jilid 2's first page is jilid 1's page_count + 1, not
 * page 1 again. Returns the inclusive [start, end] continuous page range
 * a jilid covers, or null if jilidRefs doesn't have an entry for it (or
 * for an earlier jilid needed to sum up to it).
 */
export function pageRangeForJilid(
  jilid: number,
  jilidRefs: JilidRef[],
): { start: number; end: number } | null {
  let start = 1
  for (const ref of [...jilidRefs].sort((a, b) => a.jilid - b.jilid)) {
    if (ref.jilid === jilid) return { start, end: start + ref.page_count - 1 }
    if (ref.jilid < jilid) start += ref.page_count
  }
  return null
}

/**
 * A jilid is complete when the recorded (continuous) page reaches the
 * last page of that jilid's range AND mastery is 'lancar' —
 * kurang_lancar/ulang mean the student needs to repeat pages, so the
 * jilid isn't done yet even at the last page (test-plan.md §4.2).
 */
export function isJilidComplete(
  jilid: number,
  page: number,
  mastery: YanbuahMastery,
  jilidRefs: JilidRef[],
): boolean {
  if (mastery !== 'lancar') return false
  const range = pageRangeForJilid(jilid, jilidRefs)
  if (!range) return false
  return page >= range.end
}

/**
 * Next jilid to suggest after completing one, or null at jilid 7
 * (program-complete — there is no jilid 8).
 */
export function nextJilid(jilid: number): number | null {
  return jilid < 7 ? jilid + 1 : null
}
