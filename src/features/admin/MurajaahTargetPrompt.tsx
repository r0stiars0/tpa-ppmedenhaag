import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TargetImpact } from '../../lib/groups'
import type { ActiveMurajaahTarget } from './api'

interface MurajaahTargetPromptProps {
  impacts: TargetImpact[]
  targets: ActiveMurajaahTarget[]
  busy: boolean
  /** Called with the ids of the targets to close. */
  onConfirm: (closeIds: string[]) => void
  onCancel: () => void
}

/**
 * The close-or-keep prompt (PRD Feature 8 FR-001, Resolved Decision 32).
 *
 * Shown before an admin switches a group's tracking off, archives a
 * tracking group, or takes a student out of one. A target whose student
 * would be left in no active tracking group has nobody who may manage it
 * any more, so it can only be closed — its checkbox is ticked and locked.
 * A target whose student keeps another tracking group may be kept.
 * Reminders for an orphaned target stop regardless (the safety net in
 * `send-murajaah-reminders`); this prompt is where the admin decides it
 * rather than discovering it.
 */
export function MurajaahTargetPrompt({ impacts, targets, busy, onConfirm, onCancel }: MurajaahTargetPromptProps) {
  const { t } = useTranslation()
  const [close, setClose] = useState<Set<string>>(
    () => new Set(impacts.filter((i) => i.mustClose).map((i) => i.targetId)),
  )

  function toggle(id: string) {
    setClose((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div role="group" aria-labelledby="murajaah-prompt-title" className="space-y-3 rounded-lg border-2 border-ppme-accent/40 bg-white p-4 shadow-sm">
      <h2 id="murajaah-prompt-title" className="font-semibold text-ppme-text">
        {t('admin.murajaahPromptTitle')}
      </h2>
      <p className="text-sm text-ppme-text/70">{t('admin.murajaahPromptIntro')}</p>
      <ul className="space-y-2">
        {impacts.map((impact) => {
          const target = targets.find((x) => x.id === impact.targetId)
          if (!target) return null
          return (
            <li key={impact.targetId}>
              <label className="flex min-h-11 items-start gap-2 text-sm text-ppme-text">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={close.has(impact.targetId)}
                  disabled={impact.mustClose}
                  onChange={() => toggle(impact.targetId)}
                />
                <span>
                  <span className="font-medium">{target.student?.full_name ?? '—'}</span>
                  {' · '}
                  {t('admin.murajaahPromptTarget', {
                    surah: target.surah?.transliteration ?? target.surah_num,
                    from: target.ayah_from,
                    to: target.ayah_to,
                  })}
                  <span className="block text-xs text-ppme-text/60">
                    {impact.mustClose ? t('admin.murajaahPromptMustClose') : t('admin.murajaahPromptMayKeep')}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm([...close])}
          className="min-h-11 flex-1 rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
        >
          {busy ? t('common.loading') : t('admin.murajaahPromptConfirm')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-lg border border-black/10 px-4 font-semibold text-ppme-text"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
