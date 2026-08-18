import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Database } from '../lib/database.types'

type UserProfile = Database['public']['Tables']['users']['Row']

interface AuthContextValue {
  session: Session | null
  profile: UserProfile | null
  /** True while the initial session/profile lookup is in flight. */
  loading: boolean
  /**
   * True once we know the signed-in auth.users row has no matching
   * public.users profile — i.e. a Google account not enrolled in TPA
   * (E2E-08: "contact admin" screen, no data).
   */
  unregistered: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [unregistered, setUnregistered] = useState(false)

  useEffect(() => {
    let active = true

    async function loadProfile(nextSession: Session | null) {
      if (!active) return
      setSession(nextSession)

      if (!nextSession) {
        setProfile(null)
        setUnregistered(false)
        setLoading(false)
        return
      }

      // Role is never read from the JWT/client — it is derived here by
      // querying `public.users`, which RLS restricts to the caller's own
      // row (see migration 003, policy `users_self_read`). This is the
      // one authoritative source for role-based UI decisions.
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', nextSession.user.id)
        .maybeSingle()

      if (!active) return

      if (error) {
        console.error('Failed to load user profile', error)
      }

      setProfile(data)
      setUnregistered(!data)
      setLoading(false)
    }

    supabase.auth.getSession().then(({ data }) => {
      void loadProfile(data.session)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setLoading(true)
      void loadProfile(nextSession)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      unregistered,
      signInWithGoogle: async () => {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin },
        })
        if (error) throw error
      },
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [session, profile, loading, unregistered],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
