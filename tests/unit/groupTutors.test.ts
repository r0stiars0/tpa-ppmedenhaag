import { describe, expect, it } from 'vitest'
import { headerGroups } from '../../src/lib/groupTutors'

/**
 * Which of a child's groups the family-screen header lists (PRD Feature 8
 * FR-011, TAD ADR-050(b)). Archived groups never reach this function —
 * `fetchStudentGroups` already drops them — so the rule is only about
 * the tracking switch.
 */
const yanbua = { id: 'g1', name: 'Grup A', tracks_progress: true }
const aqidah = { id: 'g2', name: 'Aqidah 9–11 th', tracks_progress: false }
const quran = { id: 'g3', name: 'Grup B', tracks_progress: true }

describe('headerGroups', () => {
  it("lists every active group on Hadir, Tugas, Rapor and the Dashboard", () => {
    expect(headerGroups([yanbua, aqidah, quran], 'all').map((g) => g.id)).toEqual(['g2', 'g1', 'g3'])
  })
  it('lists only tracking groups on Yanbu\'a, Al-Quran and Murajaah', () => {
    expect(headerGroups([yanbua, aqidah, quran], 'progress').map((g) => g.id)).toEqual(['g1', 'g3'])
  })
  it('orders groups by name, whatever order they arrive in', () => {
    expect(headerGroups([quran, yanbua], 'all').map((g) => g.name)).toEqual(['Grup A', 'Grup B'])
  })
  it('is empty for a child in no tracking group on a progress screen', () => {
    expect(headerGroups([aqidah], 'progress')).toEqual([])
  })
  it('does not mutate its input', () => {
    const input = [quran, yanbua]
    headerGroups(input, 'all')
    expect(input.map((g) => g.id)).toEqual(['g3', 'g1'])
  })
})
