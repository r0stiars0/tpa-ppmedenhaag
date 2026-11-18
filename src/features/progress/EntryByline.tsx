import { useTranslation } from 'react-i18next'
import { authorLabel, editedMarker, type AuthorMap, type EditableEntry } from '../../lib/progressEdit'

/**
 * Who recorded an entry, and — once it has been corrected — who edited it
 * and when (PRD Yanbu'a FR-007 / Quran FR-006). Names come from
 * `fn_progress_authors`; one that cannot be resolved falls back to a
 * neutral label rather than a blank or an id.
 */
export function EntryByline({
  entry,
  authors,
  formatDate,
}: {
  entry: EditableEntry
  authors: AuthorMap
  formatDate: (iso: string) => string
}) {
  const { t } = useTranslation()
  const recorder = authorLabel(entry.tutor_id, authors)
  const marker = editedMarker(entry)
  const editor = marker ? authorLabel(marker.editorId, authors) : null

  return (
    <>
      <p className="text-xs text-ppme-text/60">
        {recorder ? t('common.recordedBy', { name: recorder }) : t('common.recordedByUnknown')}
      </p>
      {marker && (
        <p className="text-xs italic text-ppme-text/60">
          {editor
            ? t('common.editedBy', { name: editor, date: formatDate(marker.at) })
            : t('common.edited', { date: formatDate(marker.at) })}
        </p>
      )}
    </>
  )
}
