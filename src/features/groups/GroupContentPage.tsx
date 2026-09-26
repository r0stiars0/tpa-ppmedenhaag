import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { getErrorMessage } from '../../lib/errors'
import { isEdited } from '../../lib/materialFiles'
import { formatDayList } from '../../lib/weekdays'
import { AnnouncementBody } from './AnnouncementBody'
import { AnnouncementForm, type AnnouncementFormValue } from './AnnouncementForm'
import { MaterialForm, type MaterialFormValue } from './MaterialForm'
import {
  createAnnouncement,
  createFileMaterial,
  createLinkMaterial,
  deleteAnnouncement,
  deleteMaterial,
  fetchAnnouncements,
  fetchAuthorNames,
  fetchGroupHeader,
  fetchGroupTutorNames,
  fetchMaterials,
  materialDownloadUrl,
  replaceMaterialFile,
  updateAnnouncement,
  updateMaterial,
  type Announcement,
  type GroupHeader,
  type Material,
} from './api'
import { fileTypeKey, formatFileSize, formatShortDate } from './format'

type Mode =
  | { kind: 'view' }
  | { kind: 'newAnnouncement' }
  | { kind: 'editAnnouncement'; item: Announcement }
  | { kind: 'newMaterial' }
  | { kind: 'editMaterial'; item: Material }

const ACTION = 'min-h-11 rounded-md px-3 text-sm font-semibold hover:bg-ppme-bg-alt'

/**
 * One group's announcements and course materials (PRD Feature 8
 * FR-004–FR-007). Everyone who can read the group sees the same page;
 * the group's own tutors and admins also get "+ Pengumuman" / "+ Materi",
 * and the author (or an admin) the edit and delete actions. RLS is the
 * boundary — these buttons only follow it.
 */
export function GroupContentPage() {
  const { id: classId = '' } = useParams()
  const { t, i18n } = useTranslation()
  const { session, profile } = useAuth()
  const me = session?.user.id ?? ''
  const isAdmin = profile?.role === 'admin'

  const [group, setGroup] = useState<GroupHeader | null>(null)
  const [tutorNames, setTutorNames] = useState<string[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [authors, setAuthors] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<Mode>({ kind: 'view' })

  const load = useCallback(async () => {
    setError(null)
    try {
      const header = await fetchGroupHeader(classId)
      if (!header) {
        setNotFound(true)
        return
      }
      const [names, a, m, authorNames] = await Promise.all([
        fetchGroupTutorNames(classId),
        fetchAnnouncements(classId),
        fetchMaterials(classId),
        fetchAuthorNames(classId),
      ])
      setGroup(header)
      setTutorNames(names)
      setAnnouncements(a)
      setMaterials(m)
      setAuthors(authorNames)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [classId])

  useEffect(() => {
    void load()
  }, [load])

  async function run(work: () => Promise<void>) {
    setSaving(true)
    setError(null)
    try {
      await work()
      setMode({ kind: 'view' })
      await load()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (notFound || !group) {
    return (
      <div className="space-y-4">
        <Link to="/groups" className="text-sm text-ppme-primary">
          ← {t('groups.title')}
        </Link>
        <p className="text-ppme-text/70">{error ?? t('groups.notFound')}</p>
      </div>
    )
  }

  const archived = group.archived_at !== null
  const canPost = !archived && (isAdmin || group.tutor_ids.includes(me))
  const mayChange = (ownerId: string) => !archived && (isAdmin || ownerId === me)
  const mayDelete = (ownerId: string) => isAdmin || (!archived && ownerId === me)
  const byline = (createdAt: string, ownerId: string) => {
    const name = authors.get(ownerId)
    const date = formatShortDate(createdAt, i18n.language)
    return name ? t('groups.byline', { date, name }) : date
  }

  function saveAnnouncement(value: AnnouncementFormValue) {
    if (mode.kind === 'editAnnouncement') {
      void run(() => updateAnnouncement(mode.item.id, value))
    } else {
      void run(() => createAnnouncement({ classId, authorId: me, ...value }))
    }
  }

  function saveMaterial(value: MaterialFormValue) {
    if (mode.kind === 'editMaterial') {
      const item = mode.item
      void run(async () => {
        await updateMaterial(item.id, {
          title: value.title,
          description: value.description,
          ...(value.kind === 'link' ? { url: value.url } : {}),
        })
        if (value.kind === 'file' && value.file && value.mimeType) await replaceMaterialFile(item, value.file, value.mimeType)
      })
    } else if (value.kind === 'file' && value.file && value.mimeType) {
      const { file, mimeType } = value
      void run(() =>
        createFileMaterial({ classId, uploadedBy: me, title: value.title, description: value.description, file, mimeType }),
      )
    } else if (value.kind === 'link') {
      void run(() => createLinkMaterial({ classId, uploadedBy: me, title: value.title, description: value.description, url: value.url }))
    }
  }

  async function download(item: Material) {
    try {
      window.location.assign(await materialDownloadUrl(item))
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const back = (
    <button type="button" onClick={() => setMode({ kind: 'view' })} className="text-sm text-ppme-primary">
      ← {group.name}
    </button>
  )

  if (mode.kind === 'newAnnouncement' || mode.kind === 'editAnnouncement') {
    return (
      <div className="space-y-4">
        {back}
        {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}
        <AnnouncementForm
          groupName={group.name}
          initial={mode.kind === 'editAnnouncement' ? mode.item : undefined}
          saving={saving}
          onSave={saveAnnouncement}
          onCancel={() => setMode({ kind: 'view' })}
        />
      </div>
    )
  }
  if (mode.kind === 'newMaterial' || mode.kind === 'editMaterial') {
    return (
      <div className="space-y-4">
        {back}
        {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}
        <MaterialForm
          initial={mode.kind === 'editMaterial' ? mode.item : undefined}
          saving={saving}
          onSave={saveMaterial}
          onCancel={() => setMode({ kind: 'view' })}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Link to="/groups" className="text-sm text-ppme-primary">
        ← {t('groups.title')}
      </Link>
      <div>
        <h1 className="text-lg font-bold text-ppme-primary">{group.name}</h1>
        <p className="text-sm text-ppme-text/70">
          {tutorNames.length > 0 ? t('groups.tutors', { names: tutorNames.join(', ') }) : t('groups.noTutors')}
          {group.meeting_days.length > 0 && ` · ${formatDayList(group.meeting_days, t)}`}
        </p>
      </div>
      {archived && <p className="rounded-lg bg-ppme-bg-alt p-3 text-sm text-ppme-text/80">{t('groups.archivedNotice')}</p>}
      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}
      {canPost && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode({ kind: 'newAnnouncement' })}
            className="min-h-11 rounded-lg bg-ppme-primary font-semibold text-white"
          >
            {t('groups.addAnnouncement')}
          </button>
          <button
            type="button"
            onClick={() => setMode({ kind: 'newMaterial' })}
            className="min-h-11 rounded-lg bg-ppme-primary font-semibold text-white"
          >
            {t('groups.addMaterial')}
          </button>
        </div>
      )}

      <section className="space-y-2" aria-labelledby="announcements-heading">
        <h2 id="announcements-heading" className="font-bold text-ppme-text">
          {t('groups.announcements')}
        </h2>
        {announcements.length === 0 ? (
          <p className="text-sm text-ppme-text/60">{t('groups.noAnnouncements')}</p>
        ) : (
          <ul className="space-y-2">
            {announcements.map((item) => (
              <li key={item.id} className="space-y-1 rounded-lg bg-white p-4 shadow-sm">
                <p className="font-semibold text-ppme-text">{item.title}</p>
                <p className="text-xs text-ppme-text/60">
                  {byline(item.created_at, item.author_id)}
                  {isEdited(item) && ` · ${t('groups.edited')}`}
                </p>
                <AnnouncementBody body={item.body} />
                {(mayChange(item.author_id) || mayDelete(item.author_id)) && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {mayChange(item.author_id) && (
                      <button
                        type="button"
                        onClick={() => setMode({ kind: 'editAnnouncement', item })}
                        className={`${ACTION} text-ppme-primary`}
                      >
                        {t('common.edit')}
                      </button>
                    )}
                    {mayDelete(item.author_id) && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          if (window.confirm(t('groups.confirmDeleteAnnouncement', { title: item.title }))) {
                            void run(() => deleteAnnouncement(item.id))
                          }
                        }}
                        className={`${ACTION} text-ppme-danger hover:bg-ppme-danger/10`}
                      >
                        {t('common.delete')}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="materials-heading">
        <h2 id="materials-heading" className="font-bold text-ppme-text">
          {t('groups.materials')}
        </h2>
        {materials.length === 0 ? (
          <p className="text-sm text-ppme-text/60">{t('groups.noMaterials')}</p>
        ) : (
          <ul className="divide-y divide-black/5 rounded-lg bg-white shadow-sm">
            {materials.map((item) => {
              const date = formatShortDate(item.created_at, i18n.language)
              const host = item.url ? new URL(item.url).host : ''
              return (
                <li key={item.id} className="space-y-1 p-4">
                  <p className="font-semibold text-ppme-text">{item.title}</p>
                  <p className="text-xs text-ppme-text/60">
                    {item.kind === 'file'
                      ? t('groups.fileMeta', {
                          type: t(fileTypeKey(item.mime_type)),
                          size: formatFileSize(item.size_bytes ?? 0, i18n.language),
                          date,
                        })
                      : t('groups.linkMeta', { host, date })}
                    {authors.get(item.uploaded_by) && ` · ${authors.get(item.uploaded_by)}`}
                    {isEdited(item) && ` · ${t('groups.edited')}`}
                  </p>
                  {item.description && <p className="text-sm text-ppme-text/80">{item.description}</p>}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {item.kind === 'file' ? (
                      <button type="button" onClick={() => void download(item)} className={`${ACTION} border border-ppme-primary text-ppme-primary`}>
                        {t('groups.download')}
                      </button>
                    ) : (
                      <a
                        href={item.url ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${ACTION} inline-flex items-center border border-ppme-primary text-ppme-primary`}
                      >
                        {t('groups.open')} ↗
                      </a>
                    )}
                    {mayChange(item.uploaded_by) && (
                      <button type="button" onClick={() => setMode({ kind: 'editMaterial', item })} className={`${ACTION} text-ppme-primary`}>
                        {t('common.edit')}
                      </button>
                    )}
                    {mayDelete(item.uploaded_by) && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          if (window.confirm(t('groups.confirmDeleteMaterial', { title: item.title }))) {
                            void run(() => deleteMaterial(item))
                          }
                        }}
                        className={`${ACTION} text-ppme-danger hover:bg-ppme-danger/10`}
                      >
                        {t('common.delete')}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
