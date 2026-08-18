import { describe, expect, it } from 'vitest'
import { getErrorMessage } from '../../src/lib/errors'

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
