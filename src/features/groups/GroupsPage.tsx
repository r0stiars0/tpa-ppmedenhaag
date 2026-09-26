import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useViewScope } from '../../context/ViewScopeContext'
import { useMyClasses } from '../../hooks/useMyClasses'
import { useMyStudents } from '../../hooks/useMyStudents'
import { useAuth } from '../../context/AuthContext'
import { ChildPicker } from '../../components/ChildPicker'
import { getErrorMessage } from '../../lib/errors'
import { firstName } from '../../lib/notificationCopy'
import { fetchStudentGroups } from '../attendance/api'
import { fetchGroupSummaries, fetchGroupTutorNames, type GroupSummary } from './api'
import { formatShortDate } from './format'

interface ListedGroup {
  id: string
  name: string
}

/**
 * The "Pengumuman & Materi" page (PRD Feature 8 FR-007): one card per
 * group. A family sees the picked child's active groups; a tutor sees
 * only the groups they teach — not their pupils' other groups, which
 * they may read but which would crowd the list (product decision); an
 * admin sees every active group.
 */
export function GroupsPage() {
  const { t } = useTranslation()
  const { scope } = useViewScope()
  return (
    <div className="space-y-4">
      <Link to="/" className="text-sm text-ppme-primary">
        ← {t('common.back')}
      </Link>
      <h1 className="text-lg font-bold text-ppme-primary">{t('groups.title')}</h1>
      {scope === 'class' ? <TutorGroupList /> : <FamilyGroupList />}
    </div>
  )
}

function TutorGroupList() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const { classes, loading, error } = useMyClasses()
  const heading = profile?.role === 'admin' ? t('groups.allGroups') : t('groups.myGroups')
  if (loading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  if (error) return <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>
  return <GroupCards heading={heading} groups={classes} />
}

function FamilyGroupList() {
  const { t } = useTranslation()
  const { students, loading: studentsLoading } = useMyStudents()
  const [studentId, setStudentId] = useState<string | null>(null)
  const [groups, setGroups] = useState<ListedGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!studentId && students.length > 0) setStudentId(students[0].id)
  }, [students, studentId])

  useEffect(() => {
    if (!studentId) return
    let active = true
    setGroups(null)
    fetchStudentGroups(studentId)
      .then((rows) => active && setGroups(rows))
      .catch((err) => active && setError(getErrorMessage(err)))
    return () => {
      active = false
    }
  }, [studentId])

  if (studentsLoading) return <p className="text-ppme-text/60">{t('common.loading')}</p>
  const student = students.find((s) => s.id === studentId)
  return (
    <>
      {students.length > 1 && <ChildPicker students={students} value={studentId} onChange={setStudentId} />}
      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}
      {groups === null ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : (
        <GroupCards heading={student ? t('groups.childGroups', { name: firstName(student.full_name) }) : ''} groups={groups} />
      )}
    </>
  )
}

function GroupCards({ heading, groups }: { heading: string; groups: ListedGroup[] }) {
  const { t, i18n } = useTranslation()
  const [summaries, setSummaries] = useState<Map<string, GroupSummary>>(new Map())
  const [tutors, setTutors] = useState<Map<string, string[]>>(new Map())
  const ids = groups.map((g) => g.id).join(',')

  useEffect(() => {
    let active = true
    const classIds = ids ? ids.split(',') : []
    Promise.all([
      fetchGroupSummaries(classIds),
      Promise.all(classIds.map(async (id) => [id, await fetchGroupTutorNames(id)] as const)),
    ])
      .then(([s, names]) => {
        if (!active) return
        setSummaries(s)
        setTutors(new Map(names))
      })
      .catch(() => {
        // The cards still link through; the page itself reports errors.
      })
    return () => {
      active = false
    }
  }, [ids])

  if (groups.length === 0) return <p className="text-ppme-text/60">{t('groups.noGroups')}</p>
  return (
    <div className="space-y-2">
      {heading && <h2 className="text-sm text-ppme-text/70">{heading}</h2>}
      <ul className="space-y-2">
        {groups.map((group) => {
          const summary = summaries.get(group.id)
          const names = tutors.get(group.id)
          return (
            <li key={group.id}>
              <Link
                to={`/groups/${group.id}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-white p-4 shadow-sm transition-colors hover:bg-ppme-bg-alt"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-ppme-text">{group.name}</span>
                  {names && (
                    <span className="block text-sm text-ppme-text/70">
                      {names.length > 0 ? t('groups.tutors', { names: names.join(', ') }) : t('groups.noTutors')}
                    </span>
                  )}
                  {summary && (
                    <span className="block text-xs text-ppme-text/60">
                      {summary.latest
                        ? t('groups.summary', {
                            announcements: summary.announcements,
                            materials: summary.materials,
                            date: formatShortDate(summary.latest, i18n.language),
                          })
                        : t('groups.summaryEmpty')}
                    </span>
                  )}
                </span>
                <span aria-hidden className="text-ppme-primary">
                  →
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
