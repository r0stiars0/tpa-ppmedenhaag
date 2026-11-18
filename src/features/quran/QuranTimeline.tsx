import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuthorMap } from '../../lib/progressEdit'
import { findSurah, type SurahRef } from '../../lib/quran'
import { EntryByline } from '../progress/EntryByline'
import type { QuranEdit, QuranProgress } from './api'
import { QUALITY_BADGE_CLASS, QUALITY_LABEL_KEY } from './quality'
import { QuranEditForm } from './QuranEditForm'

/**
 * The editing props are given only by the tutor view. Without them (the
 * family view) the timeline is read-only, with names but no controls.
 */
export interface QuranTimelineEditing {
  canEdit: (entry: QuranProgress) => boolean
  onSave: (entry: QuranProgress, patch: QuranEdit) => Promise<void>
  online: boolean
}

export function QuranTimeline({
  entries,
  surahs,
  authors,
  editing,
}: {
  entries: QuranProgress[]
  surahs: SurahRef[]
  authors: AuthorMap
  editing?: QuranTimelineEditing
}) {
  const { t, i18n } = useTranslation()
  const [editingId, setEditingId] = useState<string | null>(null)
  const dateFormatter = new Intl.DateTimeFormat(i18n.language === 'nl' ? 'nl-NL' : 'id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const formatDate = (iso: string) => dateFormatter.format(new Date(iso))

  if (entries.length === 0) return <p className="text-ppme-text/60">{t('common.empty')}</p>

  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-lg bg-white p-3 shadow-sm">
          {editing && editingId === entry.id ? (
            <QuranEditForm
              entry={entry}
              surahs={surahs}
              onSave={async (patch) => {
                await editing.onSave(entry, patch)
                setEditingId(null)
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-ppme-text">
                  {findSurah(entry.surah_num, surahs)?.transliteration ??
                    t('quran.surahNumber', { number: entry.surah_num })}{' '}
                  · {t('common.ayah')} {entry.ayah_from}–{entry.ayah_to}
                </p>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${QUALITY_BADGE_CLASS[entry.quality]}`}>
                  {t(QUALITY_LABEL_KEY[entry.quality])}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-ppme-text/60">{formatDate(entry.recorded_at)}</p>
              {entry.tajweed_notes && <p className="mt-1 text-sm text-ppme-text/70">{entry.tajweed_notes}</p>}
              <div className="mt-1">
                <EntryByline entry={entry} authors={authors} formatDate={formatDate} />
              </div>
              {editing?.canEdit(entry) && (
                <div className="mt-2">
                  <button
                    type="button"
                    disabled={!editing.online}
                    onClick={() => setEditingId(entry.id)}
                    className="min-h-11 text-sm font-medium text-ppme-primary disabled:opacity-50"
                  >
                    {t('common.edit')}
                  </button>
                  {!editing.online && (
                    <p className="text-xs text-ppme-text/60">{t('common.editOfflineHint')}</p>
                  )}
                </div>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
