import { describe, expect, it } from 'vitest'
import { needsProfileReload } from '../../src/lib/authSession'

// supabase-js announces the session again whenever the page becomes
// visible (a phone returning from the file picker) and on every token
// refresh. Treating that as a new sign-in put the whole app back into its
// loading state and threw away whatever form was open (PRD Feature 8,
// found on Android in the 8b-1 demo).
describe('needsProfileReload', () => {
  const session = (id: string) => ({ user: { id } })

  it('is false when the same account is announced again (visibility, token refresh)', () => {
    expect(needsProfileReload('u1', session('u1'))).toBe(false)
  })

  it('is true on a first sign-in, a switch to another account, and a sign-out', () => {
    expect(needsProfileReload(null, session('u1'))).toBe(true)
    expect(needsProfileReload('u1', session('u2'))).toBe(true)
    expect(needsProfileReload('u1', null)).toBe(true)
  })

  it('is true when nobody was signed in and still nobody is (settles the initial load)', () => {
    expect(needsProfileReload(null, null)).toBe(true)
  })
})
