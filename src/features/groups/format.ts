import { PPTX_MIME } from '../../lib/materialFiles'

/** "20 Sep 2026" / "20 sep. 2026", in the reader's language. */
export function formatShortDate(iso: string, language: string): string {
  return new Date(iso).toLocaleDateString(language === 'nl' ? 'nl-NL' : 'id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Amsterdam',
  })
}

/** "1,2 MB" / "850 kB". */
export function formatFileSize(bytes: number, language: string): string {
  const locale = language === 'nl' ? 'nl-NL' : 'id-ID'
  if (bytes < 1024 * 1024) {
    // A non-empty file never reads "0 kB"; an empty bucket does.
    const kb = bytes === 0 ? 0 : Math.max(1, bytes / 1024)
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(kb)} kB`
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`
}

export function fileTypeKey(mimeType: string | null): 'groups.typePptx' | 'groups.typePdf' {
  return mimeType === PPTX_MIME ? 'groups.typePptx' : 'groups.typePdf'
}
