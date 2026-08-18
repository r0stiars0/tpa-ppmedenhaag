import { afterEach, describe, expect, it, vi } from 'vitest'
import { isNetworkError } from '../../src/lib/network'

/**
 * `isNetworkError` is what decides whether a failed write gets queued
 * offline (ADR-029) or shown to the user as a real rejection — the one
 * thing worth pinning is that it reads `navigator.onLine` first and
 * only falls back to the `TypeError` shape `fetch` throws when offline
 * detection itself has nothing to say.
 *
 * This project's test environment is plain Node (`vitest.config.ts`),
 * not jsdom — Node's own built-in `navigator` global has no `onLine`
 * property at all, so there is no existing getter for `vi.spyOn` to
 * intercept. `vi.stubGlobal` replaces the global outright instead.
 */
function mockOnLine(value: boolean) {
  vi.stubGlobal('navigator', { onLine: value })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isNetworkError', () => {
  it('is true whenever the browser reports itself offline, regardless of the error', () => {
    mockOnLine(false)
    expect(isNetworkError(new Error('anything'))).toBe(true)
    expect(isNetworkError({ code: '23505' })).toBe(true)
    expect(isNetworkError(undefined)).toBe(true)
  })

  it('is true for a bare TypeError while the browser believes it is online', () => {
    mockOnLine(true)
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('is false for a real server rejection while online', () => {
    mockOnLine(true)
    expect(isNetworkError({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isNetworkError(new Error('validation failed'))).toBe(false)
  })
})
