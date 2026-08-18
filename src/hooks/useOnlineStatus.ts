import { useEffect, useState } from 'react'
import { replayQueue } from '../lib/offlineReplay'

/**
 * Tracks browser connectivity and drives the offline queue's replay:
 * once on mount (the app was reopened already online, with entries left
 * over from last time) and on every `online` transition. Mounted once
 * near the top of the app (`App.tsx`), not per-screen — the queue isn't
 * tied to whichever screen happens to be open when connectivity
 * returns.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    function handleOnline() {
      setOnline(true)
      void replayQueue()
    }
    function handleOffline() {
      setOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    if (navigator.onLine) void replayQueue()

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return online
}
