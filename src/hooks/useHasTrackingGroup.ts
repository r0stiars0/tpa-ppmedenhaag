import { useEffect, useState } from 'react'
import { fetchStudentGroups } from '../features/attendance/api'

/**
 * Whether a child is in at least one ACTIVE group with Yanbu'a/Quran/
 * Murajaah tracking on (PRD Feature 8 FR-007). `null` while unknown.
 *
 * A child who is only in an Aqidah group has no tutor who records these,
 * so their Yanbu'a, Al-Quran and Murajaah screens explain that rather
 * than showing an empty history that reads like a gap in the records.
 * A failed lookup answers `null`, never `false` — the explanation must
 * not replace real history on a bad connection.
 */
export function useHasTrackingGroup(studentId: string | null): boolean | null {
  const [hasTracking, setHasTracking] = useState<boolean | null>(null)

  useEffect(() => {
    setHasTracking(null)
    if (!studentId) return
    let active = true
    fetchStudentGroups(studentId)
      .then((groups) => {
        if (active) setHasTracking(groups.some((g) => g.tracks_progress))
      })
      .catch(() => {
        if (active) setHasTracking(null)
      })
    return () => {
      active = false
    }
  }, [studentId])

  return hasTracking
}
