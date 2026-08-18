import { useTranslation } from 'react-i18next'
import type { ClassOption } from '../hooks/useMyClasses'

interface ClassPickerProps {
  classes: ClassOption[]
  value: string | null
  onChange: (classId: string) => void
}

/** Select control for a tutor/admin with more than one assigned class. */
export function ClassPicker({ classes, value, onChange }: ClassPickerProps) {
  const { t } = useTranslation()

  if (classes.length <= 1) return null

  return (
    <label className="block text-sm font-medium text-ppme-text">
      {t('common.selectClass')}
      <select
        className="mt-1 min-h-11 w-full rounded-lg border border-black/10 bg-white px-3 text-ppme-text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.schedule ? ` — ${c.schedule}` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
