import { describe, expect, it } from 'vitest'
import { ADMIN_SECTION_TABS, NAV_TABS, bottomNavTabs } from '../../src/components/tabs'

/**
 * Guards the two properties that ADR-014's nav rework depends on, both of
 * which are easy to break silently while editing a shared component.
 *
 * The bottom tab bar renders `NAV_TABS` for every role now, so a sixth
 * entry (or a reordering) would land on tutors, parents and 16+ students
 * as much as on admin — and the order is prototype-validated, not a
 * preference (checklist §5: "do not reorder without re-validating against
 * the Figma Make prototype").
 */
describe('navigation tabs', () => {
  it('keeps the prototype-validated operational order at exactly five tabs', () => {
    expect(NAV_TABS.map((tab) => tab.to)).toEqual([
      '/attendance',
      '/assignments',
      '/yanbua',
      '/quran',
      '/murajaah',
    ])
  })

  it('keeps the admin enrollment screens out of the top-level tab set', () => {
    const topLevel = new Set<string>(NAV_TABS.map((tab) => tab.to))
    for (const tab of ADMIN_SECTION_TABS) {
      expect(tab.to.startsWith('/admin/')).toBe(true)
      expect(topLevel.has(tab.to)).toBe(false)
    }
  })

  it('appends Rapport for every role and Beheer only for admin in the mobile bar', () => {
    for (const role of ['tutor', 'parent', 'student', undefined]) {
      expect(bottomNavTabs(role).map((tab) => tab.to)).toEqual([
        '/attendance',
        '/assignments',
        '/yanbua',
        '/quran',
        '/murajaah',
        '/reports',
      ])
    }
    expect(bottomNavTabs('admin').map((tab) => tab.to)).toEqual([
      '/attendance',
      '/assignments',
      '/yanbua',
      '/quran',
      '/murajaah',
      '/reports',
      '/admin',
    ])
  })

  it('does not mutate NAV_TABS when building the mobile bar', () => {
    bottomNavTabs('admin')
    expect(NAV_TABS).toHaveLength(5)
  })
})
