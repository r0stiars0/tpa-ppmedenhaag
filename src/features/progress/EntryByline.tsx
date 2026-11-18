import { useTranslation } from 'react-i18next'
import { authorDisplay, editedMarker, type AuthorMap, type EditableEntry } from '../../lib/progressEdit'

/**
 * Who recorded an entry, and — once it has been corrected — who edited it
 * and when (PRD Yanbu'a FR-007 / Quran FR-006). Names come from
 * `fn_progress_authors`; a student assistant seen by a family reads as
 * "an assistant" (ADR-050(d)), and one that cannot be resolved falls back
 * to a neutral label rather than a blank or an id.
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
  const recorder = authorDisplay(entry.tutor_id, authors)
  const marker = editedMarker(entry)
  const editor = marker ? authorDisplay(marker.editorId, authors) : null

  return (
    <>
      <p className="text-xs text-ppme-text/60">
        {recorder.kind === 'name'
          ? t('common.recordedBy', { name: recorder.name })
          : recorder.kind === 'assistant'
            ? t('common.recordedByAssistant')
            : t('common.recordedByUnknown')}
      </p>
      {marker && editor && (
        <p className="text-xs italic text-ppme-text/60">
          {editor.kind === 'name'
            ? t('common.editedBy', { name: editor.name, date: formatDate(marker.at) })
            : editor.kind === 'assistant'
              ? t('common.editedByAssistant', { date: formatDate(marker.at) })
              : t('common.edited', { date: formatDate(marker.at) })}
        </p>
      )}
    </>
  )
}
