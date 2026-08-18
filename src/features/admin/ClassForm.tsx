import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ROLE_I18N_KEY } from '../../lib/roleLabels'
import type { DirectoryUser, AdminClass } from './api'

interface ClassFormProps {
  initial?: AdminClass
  tutors: DirectoryUser[]
  saving: boolean
  onSave: (data: { name: string; schedule: string | null; tutor_ids: string[] }) => void
  onCancel?: () => void
}

export function ClassForm({ initial, tutors, saving, onSave, onCancel }: ClassFormProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [schedule, setSchedule] = useState(initial?.schedule ?? '')
  const [tutorIds, setTutorIds] = useState<string[]>(initial?.tutor_ids ?? [])

  function toggleTutor(id: string) {
    setTutorIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-ppme-text/70">
        {t('admin.className')}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
        />
      </label>

      <label className="block text-xs font-medium text-ppme-text/70">
        {t('admin.classSchedule')}
        <input
          type="text"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-black/10 px-3 text-sm text-ppme-text"
        />
      </label>

      <div>
        <p className="text-xs font-medium text-ppme-text/70">{t('admin.assignTutors')}</p>
        {tutors.length === 0 ? (
          <p className="mt-1 text-xs text-ppme-text/50">{t('admin.noTutors')}</p>
        ) : (
          <div className="mt-1 space-y-1">
            {tutors.map((tutor) => (
              <label key={tutor.id} className="flex min-h-11 items-center gap-2 text-sm text-ppme-text">
                <input
                  type="checkbox"
                  checked={tutorIds.includes(tutor.id)}
                  onChange={() => toggleTutor(tutor.id)}
                  className="h-4 w-4"
                />
                {`${tutor.full_name} · ${t(ROLE_I18N_KEY[tutor.role])}`}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving || !name.trim()}
          onClick={() => onSave({ name: name.trim(), schedule: schedule.trim() || null, tutor_ids: tutorIds })}
          className="min-h-11 flex-1 rounded-lg bg-ppme-primary px-4 font-semibold text-white shadow-sm hover:bg-ppme-primary-dark disabled:opacity-60"
        >
          {saving ? t('common.loading') : t('common.save')}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-black/10 px-4 font-semibold text-ppme-text"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    </div>
  )
}
