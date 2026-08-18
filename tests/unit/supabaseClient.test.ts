import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The browser's Supabase singleton, and the guard clause in front of it.
 *
 * Thirteen lines that run before anything else in the app, so a mistake
 * here is a white screen rather than a failing feature. The guard exists
 * because the failure it replaces is illegible: `createClient(undefined,
 * undefined)` throws from inside the library with a message that says
 * nothing about `.env`, on somebody's first checkout of the repo.
 */
const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn(() => ({ marker: 'client' })) }))

vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

beforeEach(() => {
  vi.resetModules()
  createClientMock.mockClear()
})

afterEach(() => vi.unstubAllEnvs())

describe('the browser Supabase client', () => {
  it('is built once, from the two VITE_ variables', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')

    const { supabase } = await import('../../src/lib/supabase')
    expect(supabase).toEqual({ marker: 'client' })
    expect(createClientMock).toHaveBeenCalledTimes(1)
    // The anon key, never the service-role key: this client runs in the
    // browser and every query it makes is evaluated under RLS.
    expect(createClientMock).toHaveBeenCalledWith('https://project.supabase.co', 'anon-key')
  })

  it('fails with an actionable message when the environment is missing', async () => {
    // Names both variables and the file to copy, because the person
    // reading it is most likely setting the project up for the first
    // time.
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    await expect(import('../../src/lib/supabase')).rejects.toThrow(
      /VITE_SUPABASE_URL \/ VITE_SUPABASE_ANON_KEY.*\.env\.example/s,
    )
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('refuses a url without a key, rather than building half a client', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    await expect(import('../../src/lib/supabase')).rejects.toThrow(/Missing/)
    expect(createClientMock).not.toHaveBeenCalled()
  })
})
