import { describe, expect, it } from 'vitest'
import { isJilidComplete, nextJilid, type JilidRef } from '../../src/lib/yanbua'

const jilidRefs: JilidRef[] = Array.from({ length: 7 }, (_, i) => ({
  jilid: i + 1,
  page_count: 44,
}))

describe('isJilidComplete', () => {
  it('is complete at the last page with lancar mastery', () => {
    expect(isJilidComplete(3, 44, 'lancar', jilidRefs)).toBe(true)
  })

  it('is not complete at the last page with kurang_lancar mastery', () => {
    expect(isJilidComplete(3, 44, 'kurang_lancar', jilidRefs)).toBe(false)
  })

  it('is not complete at the last page with ulang mastery', () => {
    expect(isJilidComplete(3, 44, 'ulang', jilidRefs)).toBe(false)
  })

  it('is not complete before the last page even with lancar mastery', () => {
    expect(isJilidComplete(3, 40, 'lancar', jilidRefs)).toBe(false)
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
