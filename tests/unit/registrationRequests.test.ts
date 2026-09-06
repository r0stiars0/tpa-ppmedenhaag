import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'

/**
 * The self-service registration-request API (ADR-038): the form on the
 * Unauthorized screen writes here, and the admin Registrations page
 * reads the submitted name/context back through
 * `fn_pending_registrations()`. RLS itself is covered by pgTAP
 * (test-plan §3.4, RLS-60…64) — these pin the query shape and the small
 * pure helpers around the form.
 */
const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn(), rpc: vi.fn() },
}))

vi.mock('../../src/lib/supabase', () => ({ supabase: supabaseMock }))

const {
  fetchMyRegistrationRequest,
  submitRegistrationRequest,
  initialRegistrationName,
  isAlreadyRegisteredError,
} = await import('../../src/features/auth/api')
const { fetchPendingRegistrations } = await import('../../src/features/admin/api')

beforeEach(() => {
  supabaseMock.from.mockReset()
  supabaseMock.rpc.mockReset()
})

function stubSelect(row: unknown, error: unknown = null) {
  const calls: { table?: string; select?: string; eqColumn?: string; eqValue?: unknown } = {}
  supabaseMock.from.mockImplementation((table: string) => {
    calls.table = table
    return {
      select(columns: string) {
        calls.select = columns
        return {
          eq(column: string, value: unknown) {
            calls.eqColumn = column
            calls.eqValue = value
            return {
              maybeSingle: () => Promise.resolve({ data: error ? null : row, error }),
            }
          },
        }
      },
    }
  })
  return calls
}

function stubUpsert(error: unknown = null) {
  const calls: { table?: string; row?: Record<string, unknown>; options?: unknown } = {}
  supabaseMock.from.mockImplementation((table: string) => {
    calls.table = table
    return {
      upsert(row: Record<string, unknown>, options: unknown) {
        calls.row = row
        calls.options = options
        return Promise.resolve({ error })
      },
    }
  })
  return calls
}

describe('fetchMyRegistrationRequest', () => {
  it('returns the row for a hit, filtering on the passed id', async () => {
    const calls = stubSelect({ full_name: 'Aisha', description: 'ouder van Yusuf' })
    const result = await fetchMyRegistrationRequest('user-1')
    expect(calls.table).toBe('registration_requests')
    expect(calls.select).toBe('full_name, description')
    expect(calls.eqColumn).toBe('id')
    expect(calls.eqValue).toBe('user-1')
    expect(result).toEqual({ full_name: 'Aisha', description: 'ouder van Yusuf' })
  })

  it('returns null when there is no row', async () => {
    stubSelect(null)
    expect(await fetchMyRegistrationRequest('user-1')).toBeNull()
  })

  it('throws the PostgREST error', async () => {
    stubSelect(null, { message: 'boom' })
    await expect(fetchMyRegistrationRequest('user-1')).rejects.toEqual({ message: 'boom' })
  })
})

describe('submitRegistrationRequest', () => {
  it('upserts on the id conflict target, trimming the name', async () => {
    const calls = stubUpsert()
    await submitRegistrationRequest({ id: 'u1', full_name: '  Aisha Yusuf  ', description: '  hi  ' })
    expect(calls.table).toBe('registration_requests')
    expect(calls.options).toEqual({ onConflict: 'id' })
    expect(calls.row).toEqual({ id: 'u1', full_name: 'Aisha Yusuf', description: 'hi' })
  })

  it('stores a blank description as null, not an empty string', async () => {
    const calls = stubUpsert()
    await submitRegistrationRequest({ id: 'u1', full_name: 'Aisha', description: '   ' })
    expect(calls.row).toEqual({ id: 'u1', full_name: 'Aisha', description: null })
  })

  it('passes null description through untouched', async () => {
    const calls = stubUpsert()
    await submitRegistrationRequest({ id: 'u1', full_name: 'Aisha', description: null })
    expect(calls.row?.description).toBeNull()
  })

  it('throws the PostgREST error', async () => {
    stubUpsert({ message: 'nope', code: '23514' })
    await expect(
      submitRegistrationRequest({ id: 'u1', full_name: 'Aisha', description: null }),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('isAlreadyRegisteredError', () => {
  it('is true only for a 42501 (the self-insert policy rejecting a now-registered caller)', () => {
    expect(isAlreadyRegisteredError({ code: '42501', message: 'permission denied' })).toBe(true)
  })

  it('is false for any other error shape', () => {
    expect(isAlreadyRegisteredError({ code: '23514' })).toBe(false)
    expect(isAlreadyRegisteredError(new Error('network'))).toBe(false)
    expect(isAlreadyRegisteredError(null)).toBe(false)
    expect(isAlreadyRegisteredError('42501')).toBe(false)
  })
})

describe('initialRegistrationName', () => {
  const sessionWith = (meta: Record<string, unknown>): Session =>
    ({ user: { user_metadata: meta } }) as unknown as Session

  it('prefers an existing submission over the Google profile', () => {
    expect(
      initialRegistrationName({ full_name: 'Edited Name', description: null }, sessionWith({ full_name: 'Google Name' })),
    ).toBe('Edited Name')
  })

  it('falls back to user_metadata.full_name, then .name', () => {
    expect(initialRegistrationName(null, sessionWith({ full_name: 'Full Name', name: 'Other' }))).toBe(
      'Full Name',
    )
    expect(initialRegistrationName(null, sessionWith({ name: 'Just Name' }))).toBe('Just Name')
  })

  it('is empty when the profile carries no name and there is no session', () => {
    expect(initialRegistrationName(null, sessionWith({}))).toBe('')
    expect(initialRegistrationName(null, null)).toBe('')
  })
})

describe('fetchPendingRegistrations', () => {
  it('passes the submitted name/context through, leaving a legacy entry null', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        { id: 'a', email: 'a@x', created_at: 't', full_name: 'Submitted Name', description: 'context' },
        { id: 'b', email: 'b@x', created_at: 't', full_name: null, description: null },
      ],
      error: null,
    })
    const rows = await fetchPendingRegistrations()
    expect(supabaseMock.rpc).toHaveBeenCalledWith('fn_pending_registrations')
    expect(rows[0]).toMatchObject({ full_name: 'Submitted Name', description: 'context' })
    expect(rows[1]).toMatchObject({ full_name: null, description: null })
  })

  it('throws on error', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'bad' } })
    await expect(fetchPendingRegistrations()).rejects.toEqual({ message: 'bad' })
  })
})
