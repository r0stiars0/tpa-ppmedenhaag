import type { Database } from '../../lib/database.types'

type YanbuahMastery = Database['public']['Enums']['yanbuah_mastery']

// Gold/accent is reserved for achievement moments (jilid-complete
// celebration, streak flames) per PPME-TPA-Development-Checklist.md §5 —
// mastery badges here use success/neutral/danger instead.
export const MASTERY_BADGE_CLASS: Record<YanbuahMastery, string> = {
  lancar: 'bg-ppme-success/10 text-ppme-success',
  kurang_lancar: 'bg-ppme-text/10 text-ppme-text/70',
  ulang: 'bg-ppme-danger/10 text-ppme-danger',
}

export const MASTERY_LABEL_KEY: Record<YanbuahMastery, string> = {
  lancar: 'yanbua.masteryLancar',
  kurang_lancar: 'yanbua.masteryKurangLancar',
  ulang: 'yanbua.masteryUlang',
}
