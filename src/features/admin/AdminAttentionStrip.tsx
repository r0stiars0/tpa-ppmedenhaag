import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { countStudentsWithoutGroup } from './api'

/**
 * The admin's standing to-do, shown under the section nav on every
 * `/admin/*` screen, whichever one is opened first (PRD Feature 8 FR-002):
 * how many students are in no group. Every child enrolled from the
 * "Daftar Ulang" form arrives here, and no tutor can see them until an
 * admin places them. Renders nothing when there are none, or when the
 * count cannot be loaded — it is a pointer, not the screen's job.
 */
export function AdminAttentionStrip() {
  const { t } = useTranslation()
  const [count, setCount] = useState(0)

  useEffect(() => {
    let active = true
    countStudentsWithoutGroup()
      .then((n) => {
        if (active) setCount(n)
      })
      .catch(() => {
        if (active) setCount(0)
      })
    return () => {
      active = false
    }
  }, [])

  if (count === 0) return null
  return (
    <Link
      to="/admin/students?group=none"
      className="flex min-h-11 items-center justify-between rounded-lg bg-ppme-accent/15 px-4 text-sm font-medium text-ppme-primary"
    >
      <span className="flex items-center gap-2">
        {/* Warning triangle: an unplaced student is invisible to every tutor. */}
        <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-ppme-accent" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M8.49 2.87c.67-1.16 2.35-1.16 3.02 0l6.28 10.88c.67 1.16-.17 2.62-1.51 2.62H3.72c-1.34 0-2.18-1.46-1.51-2.62L8.49 2.87ZM10 6.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V7.5a.75.75 0 0 1 .75-.75ZM10 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            clipRule="evenodd"
          />
        </svg>
        {t('admin.studentsWithoutGroup', { count })}
      </span>
      <span aria-hidden>→</span>
    </Link>
  )
}
