import { useTranslation } from 'react-i18next'
import type { MyStudent } from '../hooks/useMyStudents'

interface ChildPickerProps {
  students: MyStudent[]
  value: string | null
  onChange: (studentId: string) => void
}

/**
 * Select control for a parent with more than one linked child.
 *
 * **The card is rendered here, and that is the point.** All five family
 * views used to wrap this call in `<div className="rounded-lg bg-white
 * p-4 shadow-sm">` themselves, while the component returns `null` for a
 * family with one child — so a single-child family got an empty white
 * box above their content on every one of those screens. A component
 * that decides it has nothing to show has to take its own chrome with
 * it; a caller cannot know in advance whether the thing it is framing
 * will render. `ScopeSwitch` returns `null` before any wrapper for the
 * same reason (ADR-025).
 *
 * This is why the `null` sits above the `<div>` rather than inside it.
 */
export function ChildPicker({ students, value, onChange }: ChildPickerProps) {
  const { t } = useTranslation()

  if (students.length <= 1) return null

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <label className="block text-sm font-medium text-ppme-text">
        {t('common.selectChild')}
        <select
          className="mt-1 min-h-11 w-full rounded-lg border border-black/10 bg-white px-3 text-ppme-text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
