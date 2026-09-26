import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Announcement } from './api'

const TITLE_MAX = 200
const BODY_MAX = 2000

export interface AnnouncementFormValue {
  title: string
  body: string
}

/** New or edited announcement (PRD Feature 8 FR-004). */
export function AnnouncementForm({
  groupName,
  initial,
  saving,
  onSave,
  onCancel,
}: {
  groupName: string
  initial?: Announcement
  saving: boolean
  onSave: (value: AnnouncementFormValue) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const valid = title.trim().length > 0 && title.length <= TITLE_MAX && body.length <= BODY_MAX

  return (
    <form
      className="space-y-3 rounded-lg bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSave({ title, body })
      }}
    >
      <h2 className="font-bold text-ppme-text">{initial ? t('groups.editAnnouncement') : t('groups.newAnnouncement')}</h2>
      <p className="text-sm text-ppme-text/70">{t('groups.forWholeGroup', { name: groupName })}</p>
      <div className="space-y-1">
        <label htmlFor="announcement-title" className="block text-sm text-ppme-text/70">
          {t('groups.titleLabel')}
        </label>
        <input
          id="announcement-title"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          className="min-h-11 w-full rounded-lg border border-black/15 px-3"
          required
        />
        <p className="text-right text-xs text-ppme-text/60">{t('groups.counter', { count: title.length, max: TITLE_MAX })}</p>
      </div>
      <div className="space-y-1">
        <label htmlFor="announcement-body" className="block text-sm text-ppme-text/70">
          {t('groups.bodyLabel')}
        </label>
        <textarea
          id="announcement-body"
          value={body}
          maxLength={BODY_MAX}
          rows={6}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-lg border border-black/15 px-3 py-2"
        />
        <p className="flex justify-between gap-2 text-xs text-ppme-text/60">
          <span>{t('groups.linksHint')}</span>
          <span>{t('groups.counter', { count: body.length, max: BODY_MAX })}</span>
        </p>
      </div>
      <p className="rounded-lg bg-ppme-primary/10 p-3 text-sm text-ppme-text">
        {initial ? t('groups.editNoNotify') : t('groups.announcementNotice')}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="submit"
          disabled={!valid || saving}
          className="min-h-11 rounded-lg bg-ppme-primary font-semibold text-white disabled:opacity-60"
        >
          {saving ? t('groups.working') : initial ? t('common.save') : t('groups.send')}
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-black/15 bg-white font-semibold">
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
