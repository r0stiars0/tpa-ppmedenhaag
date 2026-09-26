/**
 * Multi-group enrolment (PRD Feature 8, TAD ADR-045): the pure rules the
 * Functions and the screens share about which groups a student is in.
 *
 * A student's groups live in `class_members`, joined to `classes` for the
 * two switches that decide behaviour: `tracks_progress` (may this group's
 * tutors RECORD Yanbu'a/Quran/Murajaah) and `archived_at` (a frozen,
 * historical group). The database enforces both; these helpers are the
 * app's reading of the same rules, kept in one place so no screen or
 * Function restates them slightly differently.
 */
export interface MembershipRow {
  student_id: string
  class_id: string
  class: { name: string; tracks_progress: boolean; archived_at: string | null } | null
}

export interface StudentGroup {
  id: string
  name: string
  tracksProgress: boolean
  archived: boolean
}

/**
 * Students who are in at least one ACTIVE group with tracking on — the
 * students a Murajaah target can still be managed for (PRD Feature 8
 * FR-001). A target for anyone else has no tutor left who may change it,
 * so reminders about it stop (the safety net behind the admin prompt).
 */
export function studentsInActiveTrackingGroups(rows: readonly MembershipRow[]): Set<string> {
  const managed = new Set<string>()
  for (const row of rows) {
    if (row.class && row.class.tracks_progress && row.class.archived_at === null) {
      managed.add(row.student_id)
    }
  }
  return managed
}

/** One student's groups, active ones only unless asked, sorted by name. */
export function groupsOf(
  rows: readonly MembershipRow[],
  studentId: string,
  options: { includeArchived?: boolean } = {},
): StudentGroup[] {
  return rows
    .filter((row) => row.student_id === studentId && row.class !== null)
    .filter((row) => options.includeArchived || row.class!.archived_at === null)
    .map((row) => ({
      id: row.class_id,
      name: row.class!.name,
      tracksProgress: row.class!.tracks_progress,
      archived: row.class!.archived_at !== null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** An admin change that can leave a Murajaah target with no tutor to manage it. */
export type GroupChange =
  | { kind: 'trackingOff'; classId: string }
  | { kind: 'archive'; classId: string }
  | { kind: 'removeMembers'; classId: string; studentIds: string[] }
  /**
   * The student form's save. `trackingClassIds` is the chosen set's
   * active groups with tracking on — the form knows each group's
   * switches, and a swap from one Yanbu'a group to another must not read
   * as losing tracking.
   */
  | { kind: 'setGroups'; studentId: string; trackingClassIds: string[] }

export interface TargetImpact {
  targetId: string
  studentId: string
  /**
   * True when the change leaves the student in no active tracking group:
   * nobody could manage the target any more, so "keep" is not offered
   * (PRD Feature 8 FR-001, Resolved Decision 32).
   */
  mustClose: boolean
}

function activeTrackingGroups(rows: readonly MembershipRow[], studentId: string): Set<string> {
  return new Set(
    rows
      .filter((r) => r.student_id === studentId && r.class && r.class.tracks_progress && r.class.archived_at === null)
      .map((r) => r.class_id),
  )
}

/**
 * Which students' active Murajaah targets an admin change touches, and
 * for which of them the target must be closed. A student is touched when
 * the change removes one of their active tracking groups (switching it
 * off, archiving it, or taking them out of it); a change that only
 * touches non-tracking groups — an Aqidah group — touches no target.
 */
export function murajaahImpact(
  targets: readonly { id: string; student_id: string }[],
  rows: readonly MembershipRow[],
  change: GroupChange,
): TargetImpact[] {
  const impact: TargetImpact[] = []
  for (const target of targets) {
    const before = activeTrackingGroups(rows, target.student_id)
    const after = new Set(before)
    switch (change.kind) {
      case 'trackingOff':
      case 'archive':
        after.delete(change.classId)
        break
      case 'removeMembers':
        if (change.studentIds.includes(target.student_id)) after.delete(change.classId)
        break
      case 'setGroups':
        if (change.studentId === target.student_id) {
          after.clear()
          for (const id of change.trackingClassIds) after.add(id)
        }
        break
    }
    const lostOne = [...before].some((id) => !after.has(id))
    if (lostOne) {
      impact.push({ targetId: target.id, studentId: target.student_id, mustClose: after.size === 0 })
    }
  }
  return impact
}
