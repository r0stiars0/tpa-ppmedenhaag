import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { fetchStudentGroups, type StudentGroupOption } from '../attendance/api'
import { headerGroups, type HeaderKind } from '../../lib/groupTutors'
import { fetchGroupTutorNames } from './api'

/**
 * The child's groups and their tutors, under the child picker on every
 * family screen (PRD Feature 8 FR-011, TAD ADR-050). Reuses exactly what
 * the "Pengumuman & Materi" page reads: `fetchStudentGroups` (active
 * groups only) and `fn_group_tutor_names` (names only, never a student
 * assistant). Decoration: while loading, on error, or with nothing to
 * list it renders nothing, and the screen below is unaffected.
 */
export function GroupTutorsHeader({
  studentId,
  kind,
  heading,
}: {
  studentId: string | null
  kind: HeaderKind
  heading?: string
}) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<{ group: StudentGroupOption; tutors: string[] }[] | null>(null)

  useEffect(() => {
    if (!studentId) return
    let active = true
    setRows(null)
    fetchStudentGroups(studentId)
      .then((groups) =>
        Promise.all(
          headerGroups(groups, kind).map(async (group) => ({ group, tutors: await fetchGroupTutorNames(group.id) })),
        ),
      )
      .then((result) => active && setRows(result))
      .catch(() => active && setRows([]))
    return () => {
      active = false
    }
  }, [studentId, kind])

  if (!rows || rows.length === 0) return null
  return (
    <div className="rounded-lg bg-white px-4 py-3 shadow-sm">
      {heading && <p className="mb-1 text-xs font-semibold text-ppme-text/70">{heading}</p>}
      <ul className="space-y-1">
        {rows.map(({ group, tutors }) => (
          <li key={group.id} className="text-sm">
            <Link to={`/groups/${group.id}`} className="font-medium text-ppme-primary">
              {group.name}
            </Link>
            <span className="text-ppme-text/70">
              {' · '}
              {tutors.length > 0 ? tutors.join(', ') : t('groups.noTutors')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
