import { describe, expect, it } from 'vitest'
import { isJilidComplete, nextJilid, pageRangeForJilid, type JilidRef } from '../../src/lib/yanbua'

const jilidRefs: JilidRef[] = Array.from({ length: 7 }, (_, i) => ({
  jilid: i + 1,
  page_count: 44,
}))

describe('pageRangeForJilid', () => {
  it('starts jilid 1 at page 1', () => {
    expect(pageRangeForJilid(1, jilidRefs)).toEqual({ start: 1, end: 44 })
  })

  it('continues jilid 2 from jilid 1s last page, not from page 1 again', () => {
    expect(pageRangeForJilid(2, jilidRefs)).toEqual({ start: 45, end: 88 })
  })

  it('sums every earlier jilid to place jilid 7', () => {
    expect(pageRangeForJilid(7, jilidRefs)).toEqual({ start: 265, end: 308 })
  })

  it('returns null for an unknown jilid reference', () => {
    expect(pageRangeForJilid(9, jilidRefs)).toBeNull()
  })

  it('is unaffected by jilidRefs order', () => {
    const shuffled = [...jilidRefs].reverse()
    expect(pageRangeForJilid(3, shuffled)).toEqual({ start: 89, end: 132 })
  })
})

describe('isJilidComplete', () => {
  it('is complete at the last continuous page of the jilid with lancar mastery', () => {
    expect(isJilidComplete(3, 132, 'lancar', jilidRefs)).toBe(true)
  })

  it('is not complete at the last page with kurang_lancar mastery', () => {
    expect(isJilidComplete(3, 132, 'kurang_lancar', jilidRefs)).toBe(false)
  })

  it('is not complete at the last page with ulang mastery', () => {
    expect(isJilidComplete(3, 132, 'ulang', jilidRefs)).toBe(false)
  })

  it('is not complete before the last page even with lancar mastery', () => {
    expect(isJilidComplete(3, 100, 'lancar', jilidRefs)).toBe(false)
  })

  it('is not complete when page belongs to an earlier jilid only', () => {
    expect(isJilidComplete(3, 44, 'lancar', jilidRefs)).toBe(false)
  })

  it('returns false for an unknown jilid reference', () => {
    expect(isJilidComplete(9, 44, 'lancar', jilidRefs)).toBe(false)
  })
})

describe('nextJilid', () => {
  it('advances to the next jilid', () => {
    expect(nextJilid(3)).toBe(4)
  })

  it('returns null after jilid 7 (program complete)', () => {
    expect(nextJilid(7)).toBeNull()
  })
})
