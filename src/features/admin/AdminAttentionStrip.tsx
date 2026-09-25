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
      <span>{t('admin.studentsWithoutGroup', { count })}</span>
      <span aria-hidden>→</span>
    </Link>
  )
}
