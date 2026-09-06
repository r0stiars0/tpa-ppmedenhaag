import { describe, expect, it } from 'vitest'
import { getErrorMessage, isUniqueViolation } from '../../src/lib/errors'

describe('getErrorMessage', () => {
  it('returns the message from a real Error', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('returns .message from an error-shaped plain object (e.g. PostgrestError)', () => {
    expect(getErrorMessage({ message: 'function does not exist', code: 'PGRST202' })).toBe(
      'function does not exist',
    )
  })

  it('falls back to JSON instead of "[object Object]" for an object without .message', () => {
    expect(getErrorMessage({ code: 500 })).toBe('{"code":500}')
  })

  it('stringifies primitives as a last resort', () => {
    expect(getErrorMessage('plain string error')).toBe('plain string error')
  })
})

describe('isUniqueViolation', () => {
  it('recognises a PostgrestError carrying code 23505', () => {
    // The shape `offlineReplay` reads as "this write already landed",
    // and `FamilyMurajaahView` reads as "another guardian confirmed
    // today" (ADR-040 D4 — one `murajaah_log` row per assignment-day).
    expect(isUniqueViolation({ code: '23505', message: 'duplicate key value' })).toBe(true)
  })

  it('is false for any other Postgres error code', () => {
    expect(isUniqueViolation({ code: '23503', message: 'foreign key violation' })).toBe(false)
    expect(isUniqueViolation({ code: '42501', message: 'permission denied' })).toBe(false)
  })

  it('is false for a network error, a plain Error, and non-objects', () => {
    expect(isUniqueViolation(new Error('offline'))).toBe(false)
    expect(isUniqueViolation({ message: 'no code here' })).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation('23505')).toBe(false)
  })
})
