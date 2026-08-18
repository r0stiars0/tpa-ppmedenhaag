/**
 * The offline write queue: attendance, murajaah, Yanbu'a and Quran
 * recording submissions that failed because the request never reached
 * the server (`network.ts`'s `isNetworkError`) are held here until
 * `offlineReplay.ts` can retry them.
 *
 * Split in two on purpose. `createOfflineQueue` holds the only logic
 * worth testing — entry shape, oldest-first ordering, retry bookkeeping
 * — over an injected `QueueStore`, so it can be unit-tested against a
 * plain in-memory fake. `indexedDbStore` is the real browser-backed
 * store `offlineQueue` (below) uses; it is not unit-tested, because
 * jsdom (this project's test environment) has no IndexedDB
 * implementation, and a polyfill would be testing the polyfill rather
 * than this code.
 */
import { getErrorMessage } from './errors'

export type QueueKind = 'attendance' | 'murajaah' | 'yanbua' | 'quran'

export interface QueueEntry<T = unknown> {
  id: string
  kind: QueueKind
  payload: T
  createdAt: string
  attempts: number
  lastError?: string
}

export interface QueueStore {
  put(entry: QueueEntry): Promise<void>
  list(): Promise<QueueEntry[]>
  remove(id: string): Promise<void>
}

export interface OfflineQueue {
  enqueue(kind: QueueKind, payload: unknown): Promise<QueueEntry>
  list(): Promise<QueueEntry[]>
  remove(id: string): Promise<void>
  markAttempt(entry: QueueEntry, error: unknown): Promise<void>
}

export function createOfflineQueue(store: QueueStore): OfflineQueue {
  return {
    async enqueue(kind, payload) {
      const entry: QueueEntry = {
        id: crypto.randomUUID(),
        kind,
        payload,
        createdAt: new Date().toISOString(),
        attempts: 0,
      }
      await store.put(entry)
      return entry
    },

    async list() {
      const entries = await store.list()
      // Oldest first: a session and its attendance rows, or a day's
      // murajaah confirmation, must replay in the order they happened —
      // replaying out of order could apply a later entry before an
      // earlier one it logically depends on.
      return [...entries].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    },

    async remove(id) {
      await store.remove(id)
    },

    async markAttempt(entry, error) {
      await store.put({
        ...entry,
        attempts: entry.attempts + 1,
        lastError: getErrorMessage(error),
      })
    },
  }
}

const DB_NAME = 'tpa-offline-queue'
const STORE_NAME = 'entries'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open the offline queue database'))
  })
}

export function indexedDbStore(): QueueStore {
  return {
    async put(entry) {
      const db = await openDb()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite')
          tx.objectStore(STORE_NAME).put(entry)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error ?? new Error('Failed to write to the offline queue'))
        })
      } finally {
        db.close()
      }
    },

    async list() {
      const db = await openDb()
      try {
        return await new Promise<QueueEntry[]>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly')
          const req = tx.objectStore(STORE_NAME).getAll()
          req.onsuccess = () => resolve(req.result as QueueEntry[])
          req.onerror = () => reject(req.error ?? new Error('Failed to read the offline queue'))
        })
      } finally {
        db.close()
      }
    },

    async remove(id) {
      const db = await openDb()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite')
          tx.objectStore(STORE_NAME).delete(id)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error ?? new Error('Failed to remove an offline queue entry'))
        })
      } finally {
        db.close()
      }
    },
  }
}

export const offlineQueue: OfflineQueue = createOfflineQueue(indexedDbStore())
