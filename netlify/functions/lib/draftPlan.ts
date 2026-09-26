export interface DraftCandidate {
  student_id: string
  tutor_id: string
}

export interface DraftPlan {
  candidates: DraftCandidate[]
  skipped_existing: number
  /** Student is in no active group that has a tutor assigned. */
  skipped_no_tutor: number
}

/**
 * Decides who gets a draft report in a generation run (FR-001), split out
 * from the Function handler so the skip rules are unit-testable without a
 * database.
 *
 * Two reasons a student is skipped, counted separately because they mean
 * different things to the admin who pressed the button:
 *
 *   - `skipped_existing` — already has a report for this academic year.
 *     Re-running is expected and harmless (the unique constraint on
 *     `(student_id, academic_year)` is the real guarantee); this is the
 *     count that tells the admin the run was a no-op rather than a
 *     failure.
 *   - `skipped_no_tutor` — in no active group, or only in groups with an
 *     empty `tutor_ids`. `year_end_reports.tutor_id` is NOT NULL and a report
 *     without an authoring tutor has nobody who can write or publish it,
 *     so these are genuinely blocked on enrollment work, not skipped
 *     because they were already done.
 */
export interface DraftGroup {
  class_id: string
  name: string
  tracks_progress: boolean
}

/**
 * The default author of a child's report (PRD Feature 8 FR-008, TAD
 * ADR-045(h)): the first tutor of the student's first group with tracking
 * on — the tutor who writes the Yanbu'a/Quran/Murajaah part — and only if
 * there is none, the first tutor of their first other group (an
 * Aqidah-only child). "First" is by group name, so a re-run picks the
 * same author. An admin can reassign it afterwards.
 *
 * `groups` is the student's ACTIVE groups only: a tutor of an archived
 * group no longer counts as teaching the child and could not author the
 * report under `yer_tutor_rw` anyway.
 */
export function defaultAuthor(groups: readonly DraftGroup[], tutorByClass: Map<string, string>): string | undefined {
  const ordered = [...groups].sort(
    (a, b) => Number(b.tracks_progress) - Number(a.tracks_progress) || a.name.localeCompare(b.name),
  )
  for (const group of ordered) {
    const tutorId = tutorByClass.get(group.class_id)
    if (tutorId) return tutorId
  }
  return undefined
}

/**
 * The group a published report names on its "Grup / Groep" line. Before
 * migration 027 this was the student's single `students.class_id`; a
 * child now has several groups. It is the group the report's author
 * teaches the child in — tracking groups first, then by name, as in
 * `defaultAuthor` — or, when an admin reassigned the report to someone
 * who teaches the child in none of them, the group `defaultAuthor` would
 * have taken the author from. `groups` is the ACTIVE groups only.
 */
export function reportGroupName(
  groups: readonly (DraftGroup & { tutor_ids: readonly string[] })[],
  authorId: string,
): string | null {
  const ordered = [...groups].sort(
    (a, b) => Number(b.tracks_progress) - Number(a.tracks_progress) || a.name.localeCompare(b.name),
  )
  return (ordered.find((g) => g.tutor_ids.includes(authorId)) ?? ordered[0])?.name ?? null
}

export function planDrafts(input: {
  students: { id: string; groups: DraftGroup[] }[]
  tutorByClass: Map<string, string>
  existingStudentIds: Iterable<string>
}): DraftPlan {
  const existing = new Set(input.existingStudentIds)
  const plan: DraftPlan = { candidates: [], skipped_existing: 0, skipped_no_tutor: 0 }

  for (const student of input.students) {
    const tutorId = defaultAuthor(student.groups, input.tutorByClass)
    if (!tutorId) {
      plan.skipped_no_tutor += 1
      continue
    }
    if (existing.has(student.id)) {
      plan.skipped_existing += 1
      continue
    }
    plan.candidates.push({ student_id: student.id, tutor_id: tutorId })
  }

  return plan
}
