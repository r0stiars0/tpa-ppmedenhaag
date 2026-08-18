import type { Database } from './database.types'

type YanbuahMastery = Database['public']['Enums']['yanbuah_mastery']

export interface JilidRef {
  jilid: number
  page_count: number
}

/**
 * A jilid is complete when the recorded page is the last page of that
 * jilid AND mastery is 'lancar' — kurang_lancar/ulang mean the student
 * needs to repeat pages, so the jilid isn't done yet even at the last page
 * (test-plan.md §4.2).
 */
export function isJilidComplete(
  jilid: number,
  page: number,
  mastery: YanbuahMastery,
  jilidRefs: JilidRef[],
): boolean {
  if (mastery !== 'lancar') return false
  const ref = jilidRefs.find((r) => r.jilid === jilid)
  if (!ref) return false
  return page >= ref.page_count
}

/**
 * Next jilid to suggest after completing one, or null at jilid 7
 * (program-complete — there is no jilid 8).
 */
export function nextJilid(jilid: number): number | null {
  return jilid < 7 ? jilid + 1 : null
}
