import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { fetchTaughtClasses, type TaughtClass } from '../lib/capabilities'
import { getErrorMessage } from '../lib/errors'

export type ClassOption = TaughtClass

/**
 * The classes the caller teaches — every class in the TPA when they are
 * an admin (ADR-014). Only the tutor-side views use this hook.
 *
 * The filter is explicit rather than left to RLS, the tutor-side half of
 * the fix TAD ADR-019 records. `classes_read` grants a class to its
 * tutors, to an admin, to the parents of the children in it and to a
 * 16+ student enrolled in it — so an unfiltered `select` answers "every
 * class I may look at", while a class picker on a recording screen means
 * "every class I may record against". Those differ for exactly the
 * dual-role case: a tutor whose own child attends another class was
 * offered that class too, and it fails at save time.
 *
 * The admin branch has to be an explicit "all classes" rather than
 * `contains('tutor_ids', me)`, since an admin is normally in no
 * `tutor_ids` array at all and would otherwise get an empty picker.
 */
export function useMyClasses() {
  const { session, profile, loading: authLoading } = useAuth()
  const userId = session?.user.id ?? null
  const isAdmin = profile?.role === 'admin'

  const [classes, setClasses] = useState<ClassOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      // `Gate` never renders a tutor screen without a session, so this is
      // the mid-refresh moment; hold loading until auth settles on a real
      // "signed out" rather than flashing an empty picker.
      setClasses([])
      setLoading(authLoading)
      return
    }
    if (authLoading) {
      // Which query to run depends on `profile.role`, and the profile
      // lands after the session does. Asking early would run the tutor
      // query for an admin and show them no classes at all.
      setLoading(true)
      return
    }

    let active = true
    setLoading(true)
    fetchTaughtClasses(supabase, userId, { isAdmin })
      .then((rows) => {
        if (!active) return
        setClasses(rows)
        setError(null)
      })
      .catch((err) => {
        if (!active) return
        setClasses([])
        setError(getErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [userId, isAdmin, authLoading])

  return { classes, loading, error }
}
