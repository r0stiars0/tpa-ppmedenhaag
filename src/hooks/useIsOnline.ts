import { useEffect, useState } from 'react'

/**
 * Browser connectivity, read-only. Unlike `useOnlineStatus` this does not
 * drive the offline queue's replay — that hook is mounted once in `App.tsx`
 * and a second copy would replay twice. Screens that only need to know
 * whether to offer an online-only action (editing an entry, ADR-045) use this.
 */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}
