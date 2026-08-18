import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * `public/push-sw.js` runs inside the Workbox-generated service worker,
 * where neither Vitest nor Playwright can reach it directly — Playwright
 * can observe that a notification appeared, but not why it looks the way
 * it does, and never the click routing (there is no API for clicking a
 * system notification).
 *
 * So it is loaded here into a VM with a stub `self`, and its two
 * listeners are driven with the same event shapes the browser passes.
 * The live end-to-end run proves the real service worker receives real
 * pushes; this proves what it does with the edge cases.
 */
const SW_SOURCE = readFileSync(
  fileURLToPath(new URL('../../public/push-sw.js', import.meta.url)),
  'utf8',
)

interface ShownNotification {
  title: string
  options: Record<string, unknown>
}

interface FakeClient {
  focused: boolean
  navigatedTo: string | null
  focus: () => Promise<void>
  navigate?: (url: string) => Promise<void>
}

function loadServiceWorker(clients: FakeClient[] = []) {
  const listeners: Record<string, (event: unknown) => void> = {}
  const shown: ShownNotification[] = []
  const opened: string[] = []
  const pending: Promise<unknown>[] = []

  const self = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners[type] = handler
    },
    registration: {
      showNotification(title: string, options: Record<string, unknown>) {
        shown.push({ title, options })
        return Promise.resolve()
      },
    },
    clients: {
      matchAll: () => Promise.resolve(clients),
      openWindow: (url: string) => {
        opened.push(url)
        return Promise.resolve()
      },
    },
  }

  runInContext(SW_SOURCE, createContext({ self }))

  return {
    shown,
    opened,
    async push(data: unknown | undefined) {
      listeners.push({
        data: data === undefined ? null : { json: () => data },
        waitUntil: (p: Promise<unknown>) => pending.push(p),
      })
      await Promise.all(pending)
    },
    async pushRaw(thrower: () => never) {
      listeners.push({
        data: { json: thrower },
        waitUntil: (p: Promise<unknown>) => pending.push(p),
      })
      await Promise.all(pending)
    },
    async click(notification: { data?: { url?: string }; closed?: boolean }) {
      const event = {
        notification: {
          ...notification,
          close() {
            notification.closed = true
          },
        },
        waitUntil: (p: Promise<unknown>) => pending.push(p),
      }
      listeners.notificationclick(event)
      await Promise.all(pending)
    },
  }
}

function makeClient(canNavigate = true): FakeClient {
  const client: FakeClient = {
    focused: false,
    navigatedTo: null,
    focus() {
      client.focused = true
      return Promise.resolve()
    },
  }
  if (canNavigate) {
    client.navigate = (url: string) => {
      client.navigatedTo = url
      return Promise.resolve()
    }
  }
  return client
}

describe('service worker: push event', () => {
  let sw: ReturnType<typeof loadServiceWorker>

  beforeEach(() => {
    sw = loadServiceWorker()
  })

  it('renders the payload the Function built', async () => {
    await sw.push({
      title: 'TPA PPME Den Haag',
      body: 'Ali tidak hadir hari ini di TPA',
      tag: 'absence:parent-1:2026-03-10',
      url: '/attendance',
      icon: '/icons/icon-192.png',
    })

    expect(sw.shown).toHaveLength(1)
    expect(sw.shown[0].title).toBe('TPA PPME Den Haag')
    expect(sw.shown[0].options.body).toBe('Ali tidak hadir hari ini di TPA')
    expect(sw.shown[0].options.tag).toBe('absence:parent-1:2026-03-10')
    expect(sw.shown[0].options.data).toEqual({ url: '/attendance' })
  })

  it('uses a transparent silhouette for the status-bar badge, not the app icon', async () => {
    // Android masks the badge by its alpha channel and repaints it, so an
    // opaque icon renders as a solid white block — which is what shipped
    // until a real device showed it. The two slots must stay different
    // assets: `icon` is the full-colour icon in the shade, `badge` is the
    // monochrome mark for the status bar.
    await sw.push({ title: 'x', body: 'y', tag: 't', url: '/', icon: '/icons/icon-192.png' })
    expect(sw.shown[0].options.badge).toBe('/icons/badge-96.png')
    expect(sw.shown[0].options.badge).not.toBe(sw.shown[0].options.icon)
  })

  it('never re-alerts for a replaced notification', async () => {
    // Same tag replaces rather than stacks; renotify:false keeps the
    // replacement from buzzing the phone a second time for one event.
    await sw.push({ title: 'x', body: 'y', tag: 't', url: '/' })
    expect(sw.shown[0].options.renotify).toBe(false)
    expect(sw.shown[0].options.tag).toBe('t')
  })

  it('still shows something when the payload is missing', async () => {
    // A push handled without showNotification() makes Android display
    // its own "site updated in the background" notice instead.
    await sw.push(undefined)
    expect(sw.shown).toHaveLength(1)
    expect(sw.shown[0].title).toBe('TPA PPME Den Haag')
  })

  it('still shows something when the payload will not parse', async () => {
    await sw.pushRaw(() => {
      throw new Error('not json')
    })
    expect(sw.shown).toHaveLength(1)
    expect(sw.shown[0].options.tag).toBe('tpa-notification')
  })
})

describe('service worker: notification click', () => {
  it('focuses an open tab and routes it to the deep link', async () => {
    const client = makeClient()
    const sw = loadServiceWorker([client])
    const notification = { data: { url: '/attendance' }, closed: false }

    await sw.click(notification)

    expect(notification.closed).toBe(true)
    expect(client.focused).toBe(true)
    expect(client.navigatedTo).toBe('/attendance')
    expect(sw.opened).toEqual([])
  })

  it('opens a new window when the app is not already open', async () => {
    const sw = loadServiceWorker([])
    await sw.click({ data: { url: '/reports' } })
    expect(sw.opened).toEqual(['/reports'])
  })

  it('falls back to the app root when the notification carries no url', async () => {
    const sw = loadServiceWorker([])
    await sw.click({})
    expect(sw.opened).toEqual(['/'])
  })

  it('still focuses when navigate() is unavailable or rejects', async () => {
    const client = makeClient(false)
    const sw = loadServiceWorker([client])
    await sw.click({ data: { url: '/murajaah' } })
    expect(client.focused).toBe(true)
    expect(sw.opened).toEqual([])
  })
})
