import { afterEach, describe, expect, it, vi } from 'vitest'
import { isIos, isStandalone, permissionState, pushCapability } from '../../src/lib/pushCapability'

/**
 * The iOS branch is the one path test-plan §6 cannot be run for from a
 * development machine — there is no iPhone here. What *can* be pinned is
 * the decision the code makes given each platform's shape, so the
 * "install to Home Screen first" explanation is proven to be what an
 * iPhone user in a Safari tab sees, rather than the flat "unsupported"
 * message.
 */
interface FakeEnv {
  userAgent: string
  maxTouchPoints?: number
  serviceWorker?: boolean
  pushManager?: boolean
  notification?: NotificationPermission | false
  standalone?: boolean
  displayModeStandalone?: boolean
}

function stubPlatform(env: FakeEnv) {
  const navigator: Record<string, unknown> = {
    userAgent: env.userAgent,
    maxTouchPoints: env.maxTouchPoints ?? 0,
  }
  if (env.serviceWorker) navigator.serviceWorker = {}
  if (env.standalone !== undefined) navigator.standalone = env.standalone

  const window: Record<string, unknown> = {
    matchMedia: () => ({ matches: env.displayModeStandalone ?? false }),
  }
  if (env.pushManager) window.PushManager = class {}
  if (env.notification !== false && env.notification !== undefined) {
    window.Notification = { permission: env.notification }
    vi.stubGlobal('Notification', { permission: env.notification })
  }

  vi.stubGlobal('navigator', navigator)
  vi.stubGlobal('window', window)
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('platform detection', () => {
  it('recognises an iPhone', () => {
    stubPlatform({ userAgent: IPHONE })
    expect(isIos()).toBe(true)
  })

  it('recognises an iPad, which claims to be a Mac', () => {
    stubPlatform({ userAgent: IPAD, maxTouchPoints: 5 })
    expect(isIos()).toBe(true)
  })

  it('does not mistake a desktop Mac for an iPad', () => {
    stubPlatform({ userAgent: IPAD, maxTouchPoints: 0 })
    expect(isIos()).toBe(false)
  })

  it('recognises Android and desktop as not-iOS', () => {
    stubPlatform({ userAgent: ANDROID })
    expect(isIos()).toBe(false)
    stubPlatform({ userAgent: DESKTOP })
    expect(isIos()).toBe(false)
  })

  it('detects an installed (standalone) app both ways', () => {
    stubPlatform({ userAgent: IPHONE, standalone: true })
    expect(isStandalone()).toBe(true)
    stubPlatform({ userAgent: ANDROID, displayModeStandalone: true })
    expect(isStandalone()).toBe(true)
    stubPlatform({ userAgent: ANDROID })
    expect(isStandalone()).toBe(false)
  })
})

describe('push capability', () => {
  it('is ready on Android Chrome', () => {
    stubPlatform({
      userAgent: ANDROID,
      serviceWorker: true,
      pushManager: true,
      notification: 'default',
    })
    expect(pushCapability()).toBe('ready')
  })

  it('is ready on desktop Chrome', () => {
    stubPlatform({
      userAgent: DESKTOP,
      serviceWorker: true,
      pushManager: true,
      notification: 'default',
    })
    expect(pushCapability()).toBe('ready')
  })

  it('asks an iPhone in a Safari tab to install first, rather than calling it unsupported', () => {
    // iOS 16.4+ Safari exposes serviceWorker but no PushManager until
    // the site is launched from the Home Screen.
    stubPlatform({ userAgent: IPHONE, serviceWorker: true, standalone: false })
    expect(pushCapability()).toBe('ios-install-required')
  })

  it('is ready on an iPhone once installed to the Home Screen', () => {
    stubPlatform({
      userAgent: IPHONE,
      serviceWorker: true,
      pushManager: true,
      notification: 'default',
      standalone: true,
    })
    expect(pushCapability()).toBe('ready')
  })

  it('reports genuinely unsupported browsers as unsupported', () => {
    stubPlatform({ userAgent: DESKTOP })
    expect(pushCapability()).toBe('unsupported')
  })

  it('does not claim install-required for an already-installed iOS app that still lacks the APIs', () => {
    // An older iOS (pre-16.4) installed to the Home Screen genuinely
    // cannot do Web Push; telling the user to install it again would be
    // a loop.
    stubPlatform({ userAgent: IPHONE, standalone: true })
    expect(pushCapability()).toBe('unsupported')
  })
})

describe('permission state', () => {
  it('reads the browser permission when the API exists', () => {
    stubPlatform({ userAgent: DESKTOP, notification: 'granted' })
    expect(permissionState()).toBe('granted')
    stubPlatform({ userAgent: DESKTOP, notification: 'denied' })
    expect(permissionState()).toBe('denied')
  })

  it('treats a missing Notification API as denied', () => {
    stubPlatform({ userAgent: DESKTOP })
    expect(permissionState()).toBe('denied')
  })
})
