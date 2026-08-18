/**
 * Browser feature detection for Web Push, kept separate from the
 * subscribe/unsubscribe flow in `push.ts` so it can be unit-tested
 * without a Supabase client — the iOS branch in particular, which is
 * the one path this project cannot verify on real hardware from a
 * development machine (test-plan §6).
 */

export type PushCapability =
  /** Everything needed is present; subscribing is possible. */
  | 'ready'
  /** No service worker / PushManager / Notification API at all. */
  | 'unsupported'
  /**
   * iOS/iPadOS Safari 16.4+ has Web Push, but *only* for a site the
   * user has added to the Home Screen and launched from that icon. In a
   * normal Safari tab `PushManager` is simply absent, which is
   * indistinguishable from "unsupported" unless we check for iOS
   * ourselves — and telling an iPhone user their browser doesn't
   * support notifications, when it does once installed, is the broken
   * prompt checklist §5 asks us not to ship.
   */
  | 'ios-install-required'

export function isIos(): boolean {
  const ua = navigator.userAgent
  // iPadOS 13+ reports itself as a Mac; the touch-point check separates
  // an iPad from a desktop Safari.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone === true
}

export function pushCapability(): PushCapability {
  const hasApis =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (hasApis) return 'ready'
  if (isIos() && !isStandalone()) return 'ios-install-required'
  return 'unsupported'
}

export function permissionState(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'denied'
}
