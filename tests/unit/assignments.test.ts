import { describe, expect, it } from 'vitest'
import { computeDisplayStatus } from '../../src/lib/assignments'

describe('computeDisplayStatus', () => {
  it('is overdue when still pending past the due date', () => {
    expect(computeDisplayStatus('pending', '2026-08-01', '2026-08-12')).toBe('overdue')
  })

  it('is pending when not yet past the due date', () => {
    expect(computeDisplayStatus('pending', '2026-08-12', '2026-08-12')).toBe('pending')
  })

  it('is pending when due date is in the future', () => {
    expect(computeDisplayStatus('pending', '2026-08-20', '2026-08-12')).toBe('pending')
  })

  it('stays completed past the due date, not overdue', () => {
    expect(computeDisplayStatus('completed', '2026-08-01', '2026-08-12')).toBe('completed')
  })

  it('stays incomplete past the due date, not overdue', () => {
    expect(computeDisplayStatus('incomplete', '2026-08-01', '2026-08-12')).toBe('incomplete')
  })

  it('stays partial past the due date, not overdue', () => {
    expect(computeDisplayStatus('partial', '2026-08-01', '2026-08-12')).toBe('partial')
  })
})
