export interface DraftCandidate {
  student_id: string
  tutor_id: string
}

export interface DraftPlan {
  candidates: DraftCandidate[]
  skipped_existing: number
  /** Student has no class, or their class has no tutor assigned. */
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
 *   - `skipped_no_tutor` — no class, or a class with an empty
 *     `tutor_ids`. `year_end_reports.tutor_id` is NOT NULL and a report
 *     without an authoring tutor has nobody who can write or publish it,
 *     so these are genuinely blocked on enrollment work, not skipped
 *     because they were already done.
 */
export function planDrafts(input: {
  students: { id: string; class_id: string | null }[]
  tutorByClass: Map<string, string>
  existingStudentIds: Iterable<string>
}): DraftPlan {
  const existing = new Set(input.existingStudentIds)
  const plan: DraftPlan = { candidates: [], skipped_existing: 0, skipped_no_tutor: 0 }

  for (const student of input.students) {
    const tutorId = student.class_id ? input.tutorByClass.get(student.class_id) : undefined
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
