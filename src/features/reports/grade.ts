import type { ReportGrade, ReportStatus } from '../../lib/reports'

// Same convention as quran/quality.ts and yanbua/mastery.ts: gold/accent
// is reserved for achievement moments (checklist §5), so grades use
// success/neutral/danger tones instead.
export const GRADE_BADGE_CLASS: Record<ReportGrade, string> = {
  mumtaz: 'bg-ppme-success/10 text-ppme-success',
  jayyid_jiddan: 'bg-ppme-success/10 text-ppme-success',
  jayyid: 'bg-ppme-text/10 text-ppme-text/70',
  maqbul: 'bg-ppme-text/10 text-ppme-text/70',
  perlu_bimbingan: 'bg-ppme-danger/10 text-ppme-danger',
}

export const GRADE_LABEL_KEY: Record<ReportGrade, string> = {
  mumtaz: 'reports.gradeMumtaz',
  jayyid_jiddan: 'reports.gradeJayyidJiddan',
  jayyid: 'reports.gradeJayyid',
  maqbul: 'reports.gradeMaqbul',
  perlu_bimbingan: 'reports.gradePerluBimbingan',
}

export const STATUS_LABEL_KEY: Record<ReportStatus, string> = {
  draft: 'reports.statusDraft',
  published: 'reports.statusPublished',
}

export const STATUS_BADGE_CLASS: Record<ReportStatus, string> = {
  draft: 'bg-ppme-text/10 text-ppme-text/70',
  published: 'bg-ppme-success/10 text-ppme-success',
}
