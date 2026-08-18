import type { Database } from '../../lib/database.types'

type QuranQuality = Database['public']['Enums']['quran_quality']

// Gold/accent is reserved for achievement moments (jilid-complete
// celebration, streak flames) per PPME-TPA-Development-Checklist.md §5 —
// quality badges use success/neutral/danger instead, same convention as
// yanbua/mastery.ts.
export const QUALITY_BADGE_CLASS: Record<QuranQuality, string> = {
  mumtaz: 'bg-ppme-success/10 text-ppme-success',
  jayyid_jiddan: 'bg-ppme-success/10 text-ppme-success',
  jayyid: 'bg-ppme-text/10 text-ppme-text/70',
  maqbul: 'bg-ppme-text/10 text-ppme-text/70',
  perlu_perbaikan: 'bg-ppme-danger/10 text-ppme-danger',
}

export const QUALITY_LABEL_KEY: Record<QuranQuality, string> = {
  mumtaz: 'quran.qualityMumtaz',
  jayyid_jiddan: 'quran.qualityJayyidJiddan',
  jayyid: 'quran.qualityJayyid',
  maqbul: 'quran.qualityMaqbul',
  perlu_perbaikan: 'quran.qualityPerluPerbaikan',
}

export const QUALITY_OPTIONS: QuranQuality[] = [
  'mumtaz',
  'jayyid_jiddan',
  'jayyid',
  'maqbul',
  'perlu_perbaikan',
]
