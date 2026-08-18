import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { fetchFamilyLinks } from '../lib/capabilities'
import { getErrorMessage } from '../lib/errors'
import type { Tables } from '../lib/database.types'

export type MyStudent = Pick<Tables<'students'>, 'id' | 'full_name'>

/**
 * The caller's own children, plus their own record if they are a 16+
 * self-login student — the two links the family screens mean by "my
 * students" (migration 003, policies `students_parent_read` /
 * `students_self_read`).
 *
 * The filter is explicit rather than left to RLS, which is the fix TAD
 * ADR-019 records. `students` carries four permissive SELECT policies
 * and Postgres ORs them, so an unfiltered `select` returns the *union*
 * of everything the caller may read: for a parent that is their
 * children, but for anyone who also tutors it is their whole class as
 * well, and the ChildPicker would offer ~25 classmates as though they
 * were the person's own children. `students_admin_all` has no
 * `parent_id` predicate at all, so for an admin the same query returns
 * every student in the school — the risk `AttendancePage` has carried a
 * comment about since ADR-014, now closed at the query instead of by
 * routing admins away from the screen.
 *
 * RLS is unchanged and still the thing that guarantees no result can
 * include another family's child; this only stops the app asking a
 * wider question than it means.
 */
export function useMyStudents() {
  const { session, loading: authLoading } = useAuth()
  const userId = session?.user.id ?? null

  const [students, setStudents] = useState<MyStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      // `Gate` never renders a screen that uses this hook without a
      // session, so this is the mid-refresh case: hold the loading state
      // while the session resolves, rather than flashing "no children"
      // at a parent. Only once auth has settled on "signed out" does it
      // become a real empty answer.
      setStudents([])
      setLoading(authLoading)
      return
    }

    let active = true
    setLoading(true)
    fetchFamilyLinks(supabase, userId)
      .then((links) => {
        if (!active) return
        setStudents(links.map(({ id, full_name }) => ({ id, full_name })))
        setError(null)
      })
      .catch((err) => {
        if (!active) return
        setStudents([])
        setError(getErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [userId, authLoading])

  return { students, loading, error }
}
