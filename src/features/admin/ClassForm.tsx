import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ROLE_I18N_KEY } from '../../lib/roleLabels'
import { DISPLAY_ORDER, normaliseDows } from '../../lib/weekdays'
import type { DirectoryUser, AdminClass } from './api'

interface ClassFormProps {
  initial?: AdminClass
  tutors: DirectoryUser[]
  saving: boolean
  onSave: (data: {
    name: string
    schedule: string | null
    meeting_days: number[]
    tutor_ids: string[]
  }) => void
  onCancel?: () => void
}

export function ClassForm({ initial, tutors, saving, onSave, onCancel }: ClassFormProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [schedule, setSchedule] = useState(initial?.schedule ?? '')
  const [meetingDays, setMeetingDays] = useState<number[]>(
    normaliseDows(initial?.meeting_days ?? [6]),
  )
  const [tutorIds, setTutorIds] = useState<string[]>(initial?.tutor_ids ?? [])

  function toggleTutor(id: string) {
    setTutorIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  function toggleDay(dow: number) {
    setMeetingDays((prev) =>
      normaliseDows(prev.includes(dow) ? prev.filter((d) => d !== dow) : [...prev, dow]),
    )
  }

  const noDays = meetingDays.length === 0

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

      <fieldset>
        <legend className="text-xs font-medium text-ppme-text/70">{t('admin.meetingDays')}</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {DISPLAY_ORDER.map((dow) => {
            const checked = meetingDays.includes(dow)
            return (
              <label
                key={dow}
                className={`flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm ${
                  checked
                    ? 'border-ppme-primary bg-ppme-primary/10 text-ppme-primary'
                    : 'border-black/10 text-ppme-text'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleDay(dow)}
                  className="h-4 w-4"
                />
                {t(`weekday.${dow}.long`)}
              </label>
            )
          })}
        </div>
        {noDays && <p className="mt-1 text-xs text-ppme-danger">{t('admin.meetingDaysHint')}</p>}
      </fieldset>

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
          disabled={saving || !name.trim() || noDays}
          onClick={() =>
            onSave({
              name: name.trim(),
              schedule: schedule.trim() || null,
              meeting_days: meetingDays,
              tutor_ids: tutorIds,
            })
          }
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
