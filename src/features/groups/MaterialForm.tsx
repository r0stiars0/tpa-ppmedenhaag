import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { checkMaterialFile } from '../../lib/materialFiles'
import { checkMaterialLink, type MaterialLinkRefusal } from '../../lib/materialLinks'
import type { Material } from './api'

const TITLE_MAX = 200
const DESCRIPTION_MAX = 500

export type MaterialFormValue =
  | { kind: 'file'; title: string; description: string; file: File | null; mimeType: string | null }
  | { kind: 'link'; title: string; description: string; url: string }

const LINK_ERROR_KEY: Record<MaterialLinkRefusal, string> = {
  empty: 'groups.linkErrorEmpty',
  notHttps: 'groups.linkErrorNotHttps',
  shortOneDrive: 'groups.linkErrorShortOneDrive',
  sharepoint: 'groups.linkErrorSharepoint',
  googleForm: 'groups.linkErrorGoogleForm',
  driveFolder: 'groups.linkErrorDriveFolder',
  notAllowed: 'groups.linkErrorNotAllowed',
}

const FILE_ERROR_KEY = { type: 'groups.fileErrorType', size: 'groups.fileErrorSize', empty: 'groups.fileErrorEmpty' } as const

/**
 * New or edited course material (PRD Feature 8 FR-005): one PDF/PPTX
 * file, or one link from the allow-list. An existing material keeps its
 * kind; a file material can have its file replaced.
 */
export function MaterialForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial?: Material
  saving: boolean
  onSave: (value: MaterialFormValue) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<'file' | 'link'>((initial?.kind as 'file' | 'link' | undefined) ?? 'file')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [mimeType, setMimeType] = useState<string | null>(null)
  const [url, setUrl] = useState(initial?.url ?? '')
  const [urlTouched, setUrlTouched] = useState(false)

  const link = checkMaterialLink(url)
  const linkError = kind === 'link' && urlTouched && !link.ok ? t(LINK_ERROR_KEY[link.reason]) : null
  const baseValid = title.trim().length > 0 && title.length <= TITLE_MAX && description.length <= DESCRIPTION_MAX
  const valid =
    baseValid &&
    (kind === 'link' ? link.ok : initial ? fileError === null : file !== null && fileError === null)

  function pickFile(picked: File | null) {
    setFile(null)
    setMimeType(null)
    setFileError(null)
    if (!picked) return
    const check = checkMaterialFile(picked)
    if (!check.ok) {
      setFileError(t(FILE_ERROR_KEY[check.reason], { name: picked.name }))
      return
    }
    setFile(picked)
    setMimeType(check.mimeType)
  }

  return (
    <form
      className="space-y-3 rounded-lg bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault()
        setUrlTouched(true)
        if (!valid) return
        if (kind === 'link' && link.ok) onSave({ kind, title, description, url: link.url })
        if (kind === 'file') onSave({ kind, title, description, file, mimeType })
      }}
    >
      <h2 className="font-bold text-ppme-text">{initial ? t('groups.editMaterial') : t('groups.newMaterial')}</h2>
      <div className="space-y-1">
        <label htmlFor="material-title" className="block text-sm text-ppme-text/70">
          {t('groups.titleLabel')}
        </label>
        <input
          id="material-title"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          className="min-h-11 w-full rounded-lg border border-black/15 px-3"
          required
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="material-description" className="block text-sm text-ppme-text/70">
          {t('groups.descriptionLabel')}
        </label>
        <textarea
          id="material-description"
          value={description}
          maxLength={DESCRIPTION_MAX}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-lg border border-black/15 px-3 py-2"
        />
        <p className="text-right text-xs text-ppme-text/60">
          {t('groups.counter', { count: description.length, max: DESCRIPTION_MAX })}
        </p>
      </div>

      {!initial && (
        <div role="group" aria-label={t('groups.kindLabel')} className="grid grid-cols-2 overflow-hidden rounded-lg border border-ppme-primary">
          {(['file', 'link'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`min-h-11 font-semibold ${kind === k ? 'bg-ppme-primary text-white' : 'bg-white text-ppme-primary'}`}
            >
              {k === 'file' ? t('groups.kindFile') : t('groups.kindLink')}
            </button>
          ))}
        </div>
      )}

      {kind === 'file' ? (
        <div className="space-y-2">
          <label className="flex flex-col items-center gap-1 rounded-lg border-2 border-dashed border-ppme-primary/30 p-4 text-center">
            <span className="inline-flex min-h-11 items-center rounded-lg border border-ppme-primary px-4 font-semibold text-ppme-primary">
              {initial ? t('groups.replaceFile') : t('groups.chooseFile')}
            </span>
            <span className="text-xs text-ppme-text/70">{t('groups.fileHint')}</span>
            <input
              type="file"
              accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="sr-only"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {initial && !file && initial.file_name && (
            <p className="text-xs text-ppme-text/60">{t('groups.replaceHint', { name: initial.file_name })}</p>
          )}
          {file && <p className="rounded-lg bg-ppme-bg-alt px-3 py-2 text-sm">{file.name}</p>}
          {fileError && (
            <p role="alert" className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">
              {fileError}
            </p>
          )}
          {!initial && <p className="rounded-lg bg-ppme-primary/10 p-3 text-sm text-ppme-text">{t('groups.materialNotice')}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor="material-url" className="block text-sm text-ppme-text/70">
            {t('groups.urlLabel')}
          </label>
          <input
            id="material-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setUrlTouched(true)}
            aria-invalid={linkError ? true : undefined}
            aria-describedby={linkError ? 'material-url-error' : undefined}
            className={`min-h-11 w-full rounded-lg border px-3 ${linkError ? 'border-2 border-ppme-danger' : 'border-black/15'}`}
          />
          {linkError && (
            <p id="material-url-error" role="alert" className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">
              {linkError}
            </p>
          )}
          <div className="text-sm text-ppme-text">
            <p className="font-semibold">{t('groups.acceptedLinksTitle')}</p>
            <ul className="list-disc pl-5">
              <li>{t('groups.acceptedGoogleDocs')}</li>
              <li>{t('groups.acceptedDriveFile')}</li>
              <li>{t('groups.acceptedOneDrive')}</li>
            </ul>
            <p className="mt-1 text-ppme-text/70">{t('groups.refusedLinks')}</p>
          </div>
          <p className="rounded-lg border border-ppme-primary/30 bg-ppme-bg-alt p-3 text-sm text-ppme-text">
            {t('groups.sharingWarning')}
          </p>
          {!initial && <p className="rounded-lg bg-ppme-primary/10 p-3 text-sm text-ppme-text">{t('groups.materialNotice')}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="submit"
          disabled={!valid || saving}
          className="min-h-11 rounded-lg bg-ppme-primary font-semibold text-white disabled:opacity-60"
        >
          {saving ? t('groups.working') : kind === 'file' && !initial ? t('groups.upload') : t('common.save')}
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-black/15 bg-white font-semibold">
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
