import { describe, expect, it } from 'vitest'
import { isJilidComplete, nextJilid, pageRangeForJilid, type JilidRef } from '../../src/lib/yanbua'

const jilidRefs: JilidRef[] = Array.from({ length: 7 }, (_, i) => ({
  jilid: i + 1,
  page_count: 44,
}))

// The real Yanbu'a edition (ADR-048, confirmed against the physical
// book): Pemula 1-50, Jilid 1 51-96, Jilid 2 97-142, Jilid 3 143-188,
// Jilid 4 189-236, Jilid 5 237-286, Jilid 6 287-336, Jilid 7 337-386.
const realJilidRefs: JilidRef[] = [
  { jilid: 0, page_count: 50 },
  { jilid: 1, page_count: 46 },
  { jilid: 2, page_count: 46 },
  { jilid: 3, page_count: 46 },
  { jilid: 4, page_count: 48 },
  { jilid: 5, page_count: 50 },
  { jilid: 6, page_count: 50 },
  { jilid: 7, page_count: 50 },
]

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

  it('places Pemula (jilid 0) at the very start of the book', () => {
    expect(pageRangeForJilid(0, realJilidRefs)).toEqual({ start: 1, end: 50 })
  })

  it('continues Jilid 1 from Pemulas last page against the real edition', () => {
    expect(pageRangeForJilid(1, realJilidRefs)).toEqual({ start: 51, end: 96 })
  })

  it('matches the real Yanbu\'a edition end to end, through Jilid 7', () => {
    expect(pageRangeForJilid(2, realJilidRefs)).toEqual({ start: 97, end: 142 })
    expect(pageRangeForJilid(3, realJilidRefs)).toEqual({ start: 143, end: 188 })
    expect(pageRangeForJilid(4, realJilidRefs)).toEqual({ start: 189, end: 236 })
    expect(pageRangeForJilid(5, realJilidRefs)).toEqual({ start: 237, end: 286 })
    expect(pageRangeForJilid(6, realJilidRefs)).toEqual({ start: 287, end: 336 })
    expect(pageRangeForJilid(7, realJilidRefs)).toEqual({ start: 337, end: 386 })
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

  it('Pemula (jilid 0) completes at its own last page with lancar mastery', () => {
    expect(isJilidComplete(0, 50, 'lancar', realJilidRefs)).toBe(true)
  })

  it('Pemula is not complete before its last page', () => {
    expect(isJilidComplete(0, 49, 'lancar', realJilidRefs)).toBe(false)
  })
})

describe('nextJilid', () => {
  it('advances from Pemula (0) into Jilid 1', () => {
    expect(nextJilid(0)).toBe(1)
  })

  it('advances to the next jilid', () => {
    expect(nextJilid(3)).toBe(4)
  })

  it('returns null after jilid 7 (program complete)', () => {
    expect(nextJilid(7)).toBeNull()
  })
})
