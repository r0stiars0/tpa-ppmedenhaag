export interface SurahRef {
  surah_num: number
  name_arabic: string
  transliteration: string
  ayah_count: number
}

/**
 * `students.current_surah`/`current_ayah` (migration 002) exist as a
 * denormalized "current position" cache but are never written by this
 * feature. Mirroring Yanbu'a's approach (`CurrentLevelCard`, jilid
 * completion detected client-side per README's "Known gaps"), current
 * position is instead derived on read from the latest `quran_progress`
 * row (`order by recorded_at desc, limit 1`) rather than maintained as a
 * second write path — simpler, avoids denormalization drift between the
 * two, and needs no extra RLS/UPDATE policy on `students` (enrollment
 * writes to that table are admin-only, migration 003). If a future
 * milestone needs `students.current_surah`/`current_ayah` populated for
 * a class-wide query (e.g. an admin overview that can't afford to derive
 * per-student), write it from the same `quran_progress` INSERT that
 * already fires here rather than introducing an independent update path.
 */
export function findSurah(surahNum: number, surahs: SurahRef[]): SurahRef | undefined {
  return surahs.find((s) => s.surah_num === surahNum)
}

/**
 * Approximate whole-Quran completion percentage: ayahs in surahs fully
 * before the current one, plus the ayah_to reached within the current
 * surah, over the total ayah count across all seeded surahs (~6236,
 * computed from the reference data rather than hardcoded so it stays
 * correct if seed data ever changes).
 */
export function computeQuranPercent(surahNum: number, ayahTo: number, surahs: SurahRef[]): number {
  const total = surahs.reduce((sum, s) => sum + s.ayah_count, 0)
  if (total === 0) return 0
  const completedPriorSurahs = surahs
    .filter((s) => s.surah_num < surahNum)
    .reduce((sum, s) => sum + s.ayah_count, 0)
  const completed = completedPriorSurahs + ayahTo
  return Math.min(100, Math.round((completed / total) * 100))
}
