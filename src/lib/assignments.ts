import type { Database } from './database.types'

type AssignmentStatusEnum = Database['public']['Enums']['assignment_status_enum']

export type AssignmentDisplayStatus = AssignmentStatusEnum | 'overdue'

/**
 * `assignment_status_enum` has no 'overdue' value — the tutor only ever
 * writes pending/completed/incomplete/partial. "Overdue" (PRD FR-003:
 * Pending/Completed/Overdue) is a derived read-side state: a row still
 * sitting at 'pending' once its assignment's due_date has passed. Once a
 * tutor marks it completed/incomplete/partial, that verdict stands even
 * past the due date — a late-but-graded assignment isn't "overdue".
 */
export function computeDisplayStatus(
  status: AssignmentStatusEnum,
  dueDate: string,
  today: string,
): AssignmentDisplayStatus {
  if (status === 'pending' && dueDate < today) return 'overdue'
  return status
}
