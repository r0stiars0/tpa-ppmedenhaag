/**
 * Which of a child's groups the family-screen tutor header lists (PRD
 * Feature 8 FR-011, TAD ADR-050(b)).
 *
 * `'progress'` — Yanbu'a, Al-Quran, Murajaah: only groups with progress
 * tracking on, so an Aqidah tutor does not appear beside a Yanbu'a
 * history. `'all'` — Hadir, Tugas, Rapor, the Dashboard: every active
 * group. Archived groups are already gone by the time rows get here
 * (`fetchStudentGroups` filters them).
 */
export type HeaderKind = 'progress' | 'all'

export interface HeaderGroupInput {
  id: string
  name: string
  tracks_progress: boolean
}

export function headerGroups<G extends HeaderGroupInput>(groups: readonly G[], kind: HeaderKind): G[] {
  return groups
    .filter((g) => kind === 'all' || g.tracks_progress)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
}
