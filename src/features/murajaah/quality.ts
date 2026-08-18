import type { Database } from '../../lib/database.types'

type MurajaahQuality = Database['public']['Enums']['murajaah_quality']

// Gold/accent is reserved for achievement moments (streak flame,
// "Sudah Hafal" badges) per PPME-TPA-Development-Checklist.md §5 —
// quality badges here use success/neutral/danger instead, same
// convention as yanbua/mastery.ts and quran/quality.ts.
export const QUALITY_BADGE_CLASS: Record<MurajaahQuality, string> = {
  hafal_lancar: 'bg-ppme-success/10 text-ppme-success',
  hafal_kurang_lancar: 'bg-ppme-text/10 text-ppme-text/70',
  belum_hafal: 'bg-ppme-danger/10 text-ppme-danger',
}

export const QUALITY_LABEL_KEY: Record<MurajaahQuality, string> = {
  hafal_lancar: 'murajaah.qualityHafalLancar',
  hafal_kurang_lancar: 'murajaah.qualityHafalKurangLancar',
  belum_hafal: 'murajaah.qualityBelumHafal',
}

export const QUALITY_OPTIONS: MurajaahQuality[] = ['hafal_lancar', 'hafal_kurang_lancar', 'belum_hafal']
