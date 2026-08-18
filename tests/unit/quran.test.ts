import { describe, expect, it } from 'vitest'
import { computeQuranPercent, findSurah, type SurahRef } from '../../src/lib/quran'

const surahs: SurahRef[] = [
  { surah_num: 1, name_arabic: 'الفاتحة', transliteration: 'Al-Fatihah', ayah_count: 7 },
  { surah_num: 2, name_arabic: 'البقرة', transliteration: 'Al-Baqarah', ayah_count: 286 },
  { surah_num: 3, name_arabic: 'آل عمران', transliteration: 'Ali \'Imran', ayah_count: 200 },
]

describe('findSurah', () => {
  it('finds a surah by number', () => {
    expect(findSurah(2, surahs)?.transliteration).toBe('Al-Baqarah')
  })

  it('returns undefined for an unknown surah number', () => {
    expect(findSurah(114, surahs)).toBeUndefined()
  })
})

describe('computeQuranPercent', () => {
  it('is 0% when the surah reference list is empty (division-by-zero guard)', () => {
    expect(computeQuranPercent(1, 5, [])).toBe(0)
  })

  it('counts only ayahs within surah 1 when still on surah 1', () => {
    // 7 ayahs total across all seeded surahs is Al-Fatihah alone in this
    // fixture minus the other two — percent is relative to the full 493
    // total (7+286+200), so reaching ayah 7 of surah 1 is a small slice.
    expect(computeQuranPercent(1, 7, surahs)).toBe(Math.round((7 / 493) * 100))
  })

  it('adds prior surahs fully to the completed count', () => {
    // Fully through surah 1 (7) + surah 2 (286) + 50 ayahs into surah 3
    expect(computeQuranPercent(3, 50, surahs)).toBe(Math.round((343 / 493) * 100))
  })

  it('caps at 100% even if inputs overshoot the reference total', () => {
    expect(computeQuranPercent(3, 250, surahs)).toBe(100)
  })
})
